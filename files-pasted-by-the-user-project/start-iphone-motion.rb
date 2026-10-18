#!/usr/bin/env ruby
# Generate a private development CA and a LAN HTTPS certificate for the iPhone
# controller, then start the game with its normal HTTP page plus secure phone port.
require 'base64'
require 'ipaddr'
require 'openssl'
require 'rbconfig'
require 'securerandom'
require 'socket'
require 'fileutils'

ROOT = File.expand_path(__dir__)
PORT = Integer(ARGV[0] || 8765)
PHONE_PORT = Integer(ARGV[1] || PORT + 1)
CERT_DIR = File.join(Dir.home, 'Library', 'Application Support', 'Diamond Days', 'certificates')
CA_KEY_FILE = File.join(CERT_DIR, 'rootCA-key.pem')
CA_CERT_FILE = File.join(CERT_DIR, 'rootCA.pem')
PHONE_KEY_FILE = File.join(CERT_DIR, 'phone-key.pem')
PHONE_CERT_FILE = File.join(CERT_DIR, 'phone.pem')
PROFILE_FILE = File.join(CERT_DIR, 'Diamond Days iPhone Motion.mobileconfig')

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

def make_certificate(subject:, issuer:, public_key:, signing_key:, ca:, names: [], issuer_certificate: nil)
  cert = OpenSSL::X509::Certificate.new
  cert.version = 2
  cert.serial = SecureRandom.random_number(1 << 128) + 1
  cert.subject = subject
  cert.issuer = issuer
  cert.public_key = public_key
  cert.not_before = Time.now - 60
  cert.not_after = Time.now + (ca ? 10 : 2) * 365 * 24 * 60 * 60

  extensions = OpenSSL::X509::ExtensionFactory.new
  extensions.subject_certificate = cert
  cert.add_extension(extensions.create_extension('basicConstraints', ca ? 'CA:TRUE' : 'CA:FALSE', true))
  cert.add_extension(extensions.create_extension('keyUsage', ca ? 'keyCertSign,cRLSign' : 'digitalSignature,keyEncipherment', true))
  if ca
    cert.add_extension(extensions.create_extension('subjectKeyIdentifier', 'hash'))
  else
    extensions.issuer_certificate = issuer_certificate || cert
    cert.add_extension(extensions.create_extension('extendedKeyUsage', 'serverAuth'))
    san_names = ['DNS:localhost', 'IP:127.0.0.1'] + names.map { |ip| "IP:#{ip}" }
    cert.add_extension(extensions.create_extension('subjectAltName', san_names.join(',')))
    cert.add_extension(extensions.create_extension('authorityKeyIdentifier', 'keyid:always'))
  end
  cert.sign(signing_key, OpenSSL::Digest::SHA256.new)
  cert
end

def load_or_create_ca
  if File.file?(CA_KEY_FILE) && File.file?(CA_CERT_FILE)
    return [OpenSSL::PKey::RSA.new(File.read(CA_KEY_FILE)), OpenSSL::X509::Certificate.new(File.read(CA_CERT_FILE))]
  end

  key = OpenSSL::PKey::RSA.new(2048)
  name = OpenSSL::X509::Name.parse('/CN=Diamond Days iPhone Motion Root')
  cert = make_certificate(subject: name, issuer: name, public_key: key.public_key, signing_key: key, ca: true)
  File.write(CA_KEY_FILE, key.to_pem, mode: 'w', perm: 0o600)
  File.write(CA_CERT_FILE, cert.to_pem, mode: 'w', perm: 0o644)
  [key, cert]
end

def write_mobileconfig(root_certificate)
  certificate_payload = Base64.strict_encode64(root_certificate.to_der)
  root_uuid = SecureRandom.uuid
  profile_uuid = SecureRandom.uuid
  profile = <<~PLIST
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
      <key>PayloadContent</key>
      <array>
        <dict>
          <key>PayloadCertificateFileName</key><string>DiamondDaysRootCA.cer</string>
          <key>PayloadContent</key><data>#{certificate_payload}</data>
          <key>PayloadDescription</key><string>Local certificate authority for the Diamond Days phone controller.</string>
          <key>PayloadDisplayName</key><string>Diamond Days Phone Motion</string>
          <key>PayloadIdentifier</key><string>local.diamonddays.motion.root</string>
          <key>PayloadType</key><string>com.apple.security.root</string>
          <key>PayloadUUID</key><string>#{root_uuid}</string>
          <key>PayloadVersion</key><integer>1</integer>
        </dict>
      </array>
      <key>PayloadDisplayName</key><string>Diamond Days Phone Motion</string>
      <key>PayloadIdentifier</key><string>local.diamonddays.motion.profile</string>
      <key>PayloadRemovalDisallowed</key><false/>
      <key>PayloadType</key><string>Configuration</string>
      <key>PayloadUUID</key><string>#{profile_uuid}</string>
      <key>PayloadVersion</key><integer>1</integer>
    </dict>
    </plist>
  PLIST
  File.write(PROFILE_FILE, profile, mode: 'w', perm: 0o644)
end

def assert_port_free(port)
  socket = TCPSocket.new('127.0.0.1', port)
  socket.close
  abort "Port #{port} is already in use. Stop the old Diamond Days server with Ctrl+C, then run this again."
rescue Errno::ECONNREFUSED, Errno::EHOSTUNREACH
  true
ensure
  socket.close if socket && !socket.closed?
end

FileUtils.mkdir_p(CERT_DIR, mode: 0o700)
File.chmod(0o700, CERT_DIR)
addresses = local_addresses
abort 'Connect this Mac to the same Wi-Fi as your iPhone, then run this again.' if addresses.empty?
abort "The game port #{PORT} and phone port #{PHONE_PORT} must be different." if PORT == PHONE_PORT
assert_port_free(PORT)
assert_port_free(PHONE_PORT)

ca_key, ca_certificate = load_or_create_ca
server_key = OpenSSL::PKey::RSA.new(2048)
server_name = OpenSSL::X509::Name.parse('/CN=Diamond Days Phone Controller')
server_certificate = make_certificate(
  subject: server_name,
  issuer: ca_certificate.subject,
  public_key: server_key.public_key,
  signing_key: ca_key,
  ca: false,
  names: addresses,
  issuer_certificate: ca_certificate,
)
File.write(PHONE_KEY_FILE, server_key.to_pem, mode: 'w', perm: 0o600)
File.write(PHONE_CERT_FILE, server_certificate.to_pem, mode: 'w', perm: 0o644)
File.chmod(0o600, CA_KEY_FILE, PHONE_KEY_FILE)
write_mobileconfig(ca_certificate)

puts 'One-time iPhone setup: AirDrop this profile to your iPhone:'
puts PROFILE_FILE
puts 'Install it from Settings > Profile Downloaded, then enable full trust in Settings > General > About > Certificate Trust Settings.'
puts 'Keep this Terminal window open. The game remains on HTTP; the phone QR link will use trusted HTTPS.'
puts "Game: http://localhost:#{PORT}/"
puts "Phone QR port: https://#{addresses.first}:#{PHONE_PORT}/phone.html"
system('open', '-R', PROFILE_FILE) if RUBY_PLATFORM.include?('darwin')

ENV['DIAMOND_DAYS_PHONE_CERT'] = PHONE_CERT_FILE
ENV['DIAMOND_DAYS_PHONE_KEY'] = PHONE_KEY_FILE
ENV['DIAMOND_DAYS_PHONE_PORT'] = PHONE_PORT.to_s
exec(RbConfig.ruby, File.join(ROOT, 'server.rb'), PORT.to_s)
