# Taterz — a small 3D baseball game

Taterz is a playable, browser-based baseball prototype built with Three.js and plain JavaScript. Batting and pitching use the linked phone: the bat follows phone movement, and on pitching turns the player aims by pointing at the zone and holding steady briefly to release.

## Run it locally

You need Ruby (or Python 3) and an internet connection for the pinned Three.js module and web font on their free CDNs. No Node.js, npm package install, account, paid service, or build step is required.

The project folder is `/Users/shailanmathanram/Documents/Codex/2026-10-17/files-pasted-by-the-user-project`.

1. In Finder, choose **Go → Go to Folder…**, paste that path, and press Return.
2. Open Terminal, then copy and run this command:
   `cd "/Users/shailanmathanram/Documents/Codex/2026-10-17/files-pasted-by-the-user-project"`
3. Start the game with `ruby server.rb`. If Ruby is unavailable, use `python3 server.py`.
4. Leave Terminal open. In your computer browser, visit `http://localhost:8765/`.
5. Choose **Play**, select **Easy**, **Medium**, or **Hard**, then scan the QR code with your iPhone on the same Wi-Fi. Once connected, choose **Continue to Game** to start. **Settings** is an empty placeholder for now.

The server also relays phone-controller messages. Keep it running while playing. If your computer firewall asks, allow local network access so a phone on the same Wi-Fi can connect. The Ruby server accepts an optional port, for example `ruby server.rb 9000`.

## Controls

- **Batting:** use the linked phone's motion controls to position and swing the bat, or swipe through the ball on the phone controller. Mouse, keyboard, and computer touch controls cannot move the bat or swing.
- **Pitching:** on pitching turns, point the linked phone toward the desired spot in the strike zone and hold it steady briefly; the game releases the pitch automatically.
- **Pause:** press **Escape** or use the pause button. Use **Return to Menu** to leave the game.

## Phone controller

1. Start `ruby server.rb` on the computer and keep the phone on the same Wi-Fi. Choose **Play** in Taterz and scan the QR code. When the phone connects, press **Continue to Game** on the computer.
2. For iPhone motion control, stop the standard server and run `ruby start-iphone-motion.rb`. It creates a secure phone link and opens Finder to a one-time trust profile. AirDrop the `.mobileconfig` file to the iPhone, install it, then enable full trust at **Settings → General → About → Certificate Trust Settings**. Keep the Terminal window open. The game remains at `http://localhost:8765/`; its **Play** pairing screen now opens the iPhone controller over trusted HTTPS. No Homebrew or package install is required.
3. Hold the iPhone in your natural batting grip with its screen facing you, then tap **Enable Motion Sensors**. Its first sensor reading becomes the neutral pose automatically; there are no position captures.
4. The computer shows the live 3D phone orientation, and the bat follows that same motion. Increasing roll turns the bat clockwise; decreasing roll turns it counterclockwise. Swing forward as the pitch reaches the plate. The swipe pad remains a fallback.

## What is implemented

- A stadium practice field with a procedural sky, sun glow, distant hills, drifting breeze ribbons, far birds, crowd, and seating stripes. The ground uses tileable gravel and grass textures, short instanced grass blades, warm directional sunlight, and soft cast shadows. Ball contact creates a brief light flash, sparks, camera shake, and a sharper bat crack; ground bounces kick up a little dust.
- A low, centered batting view modeled on the reference image: the batter sits in the left foreground, with the plate and pitcher visible ahead. The live scoreboard appears as a broadcast-style HUD with inning, count, outs, score, and base occupancy; home runs trigger an animated speaker graphic and run card.
- Team-colored baseball caps with curved visors and subtle woven fabric texture on the caps and jerseys. Characters have shorter capsule torsos, detached helmeted heads with a small chin shape and no neck, and shoes that float separately with no connecting legs. The batter faces toward screen-right in a stance with both hands on the bat.
- A strike zone narrowed slightly to line up with home plate and pitches that stay near it, with only small misses outside the edges.
- Four randomized pitch types: very fast straight fastballs with a small break (50%), medium-speed curveballs with a stronger downward break (20%), fast sliders with a late sideways break (20%), and fast CIR changes with a small late circular break (10%). Their paths use smooth late movement and stay relatively low.
- Three selectable difficulties adjust pitching and contact. **Easy** throws mostly strikes at a slower speed and gives more contact and power help. **Medium** reduces weak-contact fouls and makes solid contact and home runs easier. **Hard** keeps the original pitch, contact, and foul settings.
- Batting practice keeps a forgiving bat contact window and timing, with faster and lower good-contact drives, a shorter home-run distance, a complete swing-and-return animation, 3.5 seconds between pitches, and 6.1 seconds of readiness time after a batter-changing result. Weak contact has an 18% foul-ball chance on Easy, 28% on Medium, and 42% on Hard. Many fair weak contacts become grounders; fair weak-contact pop-ups give a reachable fielder a 90% catch chance.
- Longer sweeping 3D bat with segment-to-ball collision. Timing, collision accuracy, swing speed, contact lane, and swing angle contribute to the hit's launch speed and direction.
- Automatic computer pitching. Hard uses the original 72% strike rate and limits calls to two identical results in a row; Medium slightly favors strikes; Easy throws strikes about 90% of the time and permits longer streaks. Easy slows pitches; Easy and Medium also add contact and power help. Pitching supports batter-only practice innings, fair/foul outcomes, distance-based hits, walks, foul-ball count rules, and strikeouts. The HUD shows balls, strikes, outs, live team scores, inning, and base occupancy.
- The pitcher, four infielders, and three outfielders have articulated arms and brown fielding mitts. The pitcher winds up and throws on each pitch. All defenders run at 4.2 speed units, base runners at 7.2, and fielding throws travel at 42 units per second. The game sends the closest reachable defender to a batted ball while assigning unique infield coverage at first, second, third, and home. Reachable weak-contact pop-ups have a 90% catch chance; reachable good-contact fly balls have a 10% catch chance. Missed catches fall through to the ground-ball play. Grounders bounce, roll, and are fielded before a fast throw to the runner's destination or first base. Existing runners advance at most one base per non-home-run hit; home runs score every runner. Runs do not count on a third out.
- Bat-ball contact triggers a synthesized bat-crack sound on the game computer and sends a one-second vibration request to the connected phone. Phone vibration depends on browser support; iPhone Safari does not currently expose the web vibration API.
- After bat contact, the camera follows the ball through its flight and fielding result, then follows the batter's run before smoothly returning to the plate view. Home runs keep a bright red trajectory trail through the ball's flight; other high-speed hits get a warm trail, stronger sparks, and a bigger camera shake.
- The menu's **Settings** screen adjusts the stadium's time of day (morning, day, sunset, or night), sunlight strength, and breeze strength. These choices are saved in the browser for the next visit.
- Safe good-contact hits that stay in the park are assigned as 70% singles, 20% doubles, and 10% triples. Home runs retain their fence-clear result.
- Runners animate their floating shoes independently with smooth alternating lift and stride, counter-swing their arms, and bob lightly as they pass through each base. They turn to face the direction they are running, including all four legs of a home-run circuit. The next pitch waits until the longest runner route has finished.
- A Taterz menu with a single **Play** pairing flow, a **Settings** screen for time-of-day, sunlight, and wind controls, a jersey-blue fade behind white title text, rounded white windows, friendly Fredoka/Nunito typography, and a white hand cursor outlined in jersey blue. The titled pairing screen has a QR code and scan instructions beside the live phone orientation, plus a **Continue to Game** button that becomes available when the phone connects. Batting uses phone motion or the phone swipe pad only; pause and menu buttons remain available on the computer. The HUD uses blue and red for the two teams, and home-run celebrations retain their original purple and gold palette.

## Prototype limits

- Fielding is a compact prototype: each bag and home has an infielder covering it and ground-ball throws are animated, while base occupancy is tracked without individual runner identities; steals, lineups, relay throws, and full tag-up rules are not modeled.
- The player bats against computer pitching and pitches to computer batters on the alternating defensive turns. There are no separate pitch-type buttons; phone aim controls the release direction.
- iPhone motion requires a trusted HTTPS page and the one-time profile created by `start-iphone-motion.rb`. Tap **Enable Motion Sensors** while holding the phone in your batting grip. The first reading automatically sets the neutral pose. The computer shows the live 3D phone orientation, and the bat follows it: increasing roll rotates clockwise and decreasing roll rotates counterclockwise. A fast rotation or acceleration starts a swing, and collision uses the bat's swept path through the pitch.
- Three.js is loaded from jsDelivr at version 0.186.1, so the first launch needs internet access. The QR encoder, game's other source files, and server are local.

## Project map

- `index.html`, `styles.css` — game UI and menus.
- `js/main.js` — gameplay loop, scene orchestration, controls, and UI updates.
- `js/field.js`, `js/sky.js`, `js/wind.js` — textured field, striped stadium, colorful crowd, Mii-like player models with woven uniforms, procedural sky, breeze ribbons, and birds.
- `js/fielding.js` — fielder selection and timing decisions for catches, force plays, tags, and plays at first.
- `js/rules.js` — count, inning, base-runner, out, and scoring logic.
- `js/phone.js`, `js/phone-controller.js` — phone motion, swipe, and relay controls.
- `js/qrcode.js` — local QR generation for phone pairing; it does not need a QR service.
- `server.rb`, `server.py` — local static servers and dependency-free WebSocket relays.
