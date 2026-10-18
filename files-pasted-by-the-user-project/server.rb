#!/usr/bin/env ruby
# Lightweight local file server and WebSocket message relay. Uses Ruby's standard library only.
require 'base64'
require 'digest/sha1'
require 'json'
require 'ipaddr'
require 'openssl'
require 'socket'
require 'uri'

ROOT = File.expand_path(__dir__)
PORT = Integer(ARGV[0] || 8765)
DEFAULT_PHONE_PORT = PORT + 1
HOST = '0.0.0.0'
GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
CLIENTS = {}
CLIENTS_LOCK = Mutex.new

MIME = {
  '.html' => 'text/html; charset=utf-8', '.css' => 'text/css; charset=utf-8',
  '.js' => 'text/javascript; charset=utf-8', '.mjs' => 'text/javascript; charset=utf-8',
  '.json' => 'application/json; charset=utf-8', '.svg' => 'image/svg+xml',
  '.png' => 'image/png', '.jpg' => 'image/jpeg', '.ico' => 'image/x-icon'
}.freeze

def exact_read(io, count)
  data = +''
  while data.bytesize < count
    chunk = io.read(count - data.bytesize)
    return nil if chunk.nil? || chunk.empty?
    data << chunk
  end
  data
end

def websocket_frame(payload, opcode = 1)
  length = payload.bytesize
  prefix = if length < 126
             [0x80 | opcode, length].pack('CC')
           elsif length <= 65_535
             [0x80 | opcode, 126, length].pack('CCn')
           else
             [0x80 | opcode, 127, length].pack('CCQ>')
           end
  prefix + payload
end

def send_safe(socket, mutex, payload, opcode = 1)
  return false unless socket && mutex
  mutex.synchronize { socket.write(websocket_frame(payload, opcode)) }
rescue IOError, SystemCallError, OpenSSL::SSL::SSLError
  false
end

def relay(sender, payload)
  message = JSON.parse(payload) rescue {}
  role = CLIENTS_LOCK.synchronize { CLIENTS.dig(sender, :role) }
  if message['type'] == 'hello' && %w[game phone].include?(message['role'])
    role = message['role']
    peers = CLIENTS_LOCK.synchronize do
      CLIENTS[sender][:role] = role if CLIENTS[sender]
      CLIENTS.reject { |socket, _info| socket.equal?(sender) }.to_a
    end
    # Tell a newly joined client which counterpart is already connected.
    peers.each do |_socket, info|
      peer_role = info[:role]
      send_safe(sender, CLIENTS[sender][:mutex], { type: 'hello', role: peer_role }.to_json) if %w[game phone].include?(peer_role)
    end
    # Send the new client's hello only to the other role.
    peers.each do |socket, info|
      next unless info[:role] && info[:role] != role
      send_safe(socket, info[:mutex], payload)
    end
    return
  end
  target_role = role == 'phone' ? 'game' : (role == 'game' ? 'phone' : nil)
  return unless target_role
  peers = CLIENTS_LOCK.synchronize { CLIENTS.reject { |socket, info| socket.equal?(sender) || info[:role] != target_role }.to_a }
  peers.each do |socket, info|
    unless send_safe(socket, info[:mutex], payload)
      CLIENTS_LOCK.synchronize { CLIENTS.delete(socket) }
    end
  end
end

def handle_websocket(client, headers)
  key = headers['sec-websocket-key']
  return client.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n") unless key
  accept = Base64.strict_encode64(Digest::SHA1.digest(key + GUID))
  client.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: #{accept}\r\n\r\n")
  client.sync = true
  mutex = Mutex.new
  CLIENTS_LOCK.synchronize { CLIENTS[client] = { mutex: mutex, role: nil } }
  loop do
    header = exact_read(client, 2)
    break unless header
    first, second = header.unpack('CC')
    opcode = first & 0x0f
    length = second & 0x7f
    if length == 126
      extended = exact_read(client, 2)
      break unless extended
      length = extended.unpack1('n')
    elsif length == 127
      extended = exact_read(client, 8)
      break unless extended
      length = extended.unpack1('Q>')
    end
    break if length > 1_000_000
    mask = (second & 0x80).zero? ? nil : exact_read(client, 4)
    break if (second & 0x80) != 0 && mask.nil?
    payload = exact_read(client, length) || ''.b
    if mask
      bytes = payload.bytes
      key_bytes = mask.bytes
      payload = bytes.each_with_index.map { |byte, index| byte ^ key_bytes[index % 4] }.pack('C*')
    end
    case opcode
    when 8
      break
    when 9
      send_safe(client, mutex, payload, 10)
    when 1
      relay(client, payload)
    end
  end
rescue IOError, SystemCallError, OpenSSL::SSL::SSLError
  nil
ensure
  role = CLIENTS_LOCK.synchronize { CLIENTS.delete(client)&.dig(:role) }
  if %w[game phone].include?(role)
    others = CLIENTS_LOCK.synchronize { CLIENTS.values.any? { |info| info[:role] == role } }
    unless others
      opposite = role == 'phone' ? 'game' : 'phone'
      payload = { type: 'peer-left', role: role }.to_json
      peers = CLIENTS_LOCK.synchronize { CLIENTS.reject { |_socket, info| info[:role] != opposite }.to_a }
      peers.each { |socket, info| send_safe(socket, info[:mutex], payload) }
    end
  end
  client.close rescue nil
end

def respond(client, status, content_type, body)
  reason = { 200 => 'OK', 403 => 'Forbidden', 404 => 'Not Found', 426 => 'Upgrade Required' }[status] || 'Error'
  client.write("HTTP/1.1 #{status} #{reason}\r\nContent-Type: #{content_type}\r\nContent-Length: #{body.bytesize}\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n")
  client.write(body) unless body.empty?
end

def handle_client(client)
  line = client.gets("\r\n")
  return client.close unless line
  method, raw_path, _version = line.strip.split(' ', 3)
  headers = {}
  while (header = client.gets("\r\n"))
    break if header == "\r\n"
    key, value = header.split(':', 2)
    headers[key.downcase] = value.to_s.strip if key
  end

  path = URI.parse(raw_path || '/').path
  if path == '/ws'
    if headers['upgrade'].to_s.downcase != 'websocket'
      respond(client, 426, 'text/plain; charset=utf-8', 'WebSocket upgrade required\n')
    else
      handle_websocket(client, headers)
    end
    return
  end
  if path == '/health'
    respond(client, 200, 'text/plain; charset=utf-8', method == 'HEAD' ? ''.b : "ok\n".b)
    return
  end
  if path == '/connect-info'
    body = {
      addresses: local_addresses,
      port: PORT,
      scheme: $diamond_scheme,
      phonePort: $diamond_phone_port,
      phoneScheme: $diamond_phone_scheme,
    }.to_json
    respond(client, 200, 'application/json; charset=utf-8', method == 'HEAD' ? ''.b : body)
    return
  end

  relative = URI::DEFAULT_PARSER.unescape(path.sub(%r{\A/+}, ''))
  relative = 'index.html' if relative.empty?
  file = File.expand_path(relative, ROOT)
  unless file == ROOT || file.start_with?(ROOT + File::SEPARATOR)
    respond(client, 403, 'text/plain; charset=utf-8', "forbidden\n".b)
    return
  end
  unless File.file?(file)
    respond(client, 404, 'text/plain; charset=utf-8', "not found\n".b)
    return
  end
  body = method == 'HEAD' ? ''.b : File.binread(file)
  respond(client, 200, MIME.fetch(File.extname(file), 'application/octet-stream'), body)
rescue URI::InvalidURIError, IOError, SystemCallError
  client.close rescue nil
end

def local_addresses
  preferred = nil
  probe = UDPSocket.new
  begin
    probe.connect('192.0.2.1', 80)
    preferred = probe.addr[3]
    preferred = nil if preferred.start_with?('127.')
  rescue SystemCallError
    preferred = nil
  ensure
    probe.close
  end
  found = Socket.getifaddrs.map do |interface|
    address = interface.addr
    next unless address && address.afamily == Socket::AF_INET
    ip = address.ip_address
    next if ip.start_with?('127.')
    ip
  end.compact.uniq
  ([preferred].compact + found.sort).uniq
rescue StandardError
  []
end

tls_cert = ENV['DIAMOND_DAYS_CERT']
tls_key = ENV['DIAMOND_DAYS_KEY']
phone_cert = ENV['DIAMOND_DAYS_PHONE_CERT']
phone_key = ENV['DIAMOND_DAYS_PHONE_KEY']
scheme = 'http'
listener = TCPServer.new(HOST, PORT)
if tls_cert && tls_key
  context = OpenSSL::SSL::SSLContext.new
  context.cert = OpenSSL::X509::Certificate.new(File.read(tls_cert))
  context.key = OpenSSL::PKey.read(File.read(tls_key))
  listener = OpenSSL::SSL::SSLServer.new(listener, context)
  scheme = 'https'
elsif tls_cert || tls_key
  abort 'Set both DIAMOND_DAYS_CERT and DIAMOND_DAYS_KEY to enable HTTPS.'
end
$diamond_scheme = scheme
$diamond_phone_scheme = scheme
$diamond_phone_port = PORT

if phone_cert && phone_key
  phone_port = Integer(ENV['DIAMOND_DAYS_PHONE_PORT'] || DEFAULT_PHONE_PORT)
  phone_listener = TCPServer.new(HOST, phone_port)
  phone_context = OpenSSL::SSL::SSLContext.new
  phone_context.cert = OpenSSL::X509::Certificate.new(File.read(phone_cert))
  phone_context.key = OpenSSL::PKey.read(File.read(phone_key))
  phone_listener = OpenSSL::SSL::SSLServer.new(phone_listener, phone_context)
  $diamond_phone_scheme = 'https'
  $diamond_phone_port = phone_port
  Thread.new do
    loop do
      begin
        client = phone_listener.accept
        Thread.new(client) { |connection| handle_client(connection) }
      rescue OpenSSL::SSL::SSLError, IOError, SystemCallError
        next
      end
    end
  end
elsif phone_cert || phone_key
  abort 'Set both DIAMOND_DAYS_PHONE_CERT and DIAMOND_DAYS_PHONE_KEY to enable HTTPS phone controls.'
end

puts 'Diamond Days is running. Keep this terminal open.'
puts "Game: #{scheme}://localhost:#{PORT}/"
puts "Phone: #{$diamond_phone_scheme}://localhost:#{$diamond_phone_port}/phone.html"
local_addresses.each { |address| puts "Same-Wi-Fi phone: #{$diamond_phone_scheme}://#{address}:#{$diamond_phone_port}/phone.html" }
puts 'Stop the server with Ctrl+C.'
loop do
  client = listener.accept
  Thread.new(client) do |connection|
    handle_client(connection)
  end
end
