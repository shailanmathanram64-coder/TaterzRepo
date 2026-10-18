# V1 Game Design and Requirements

## Core idea

Build a playable browser-based 3D baseball game. The player bats against a computer pitcher. The main V1 goal is a reliable batting loop, especially controlling the bat by moving and swinging an iPhone. Keep the presentation simple while the gameplay is being made to work.

## V1 gameplay

- The player is always the batter. The computer automatically pitches; do not add a player-pitching mode or a separate pitching view.
- Show the pitcher and ball from the batter's view. The computer chooses a varied target in or near the strike zone and sends a moving 3D ball toward home plate.
- The player positions and swings the bat to try to contact the ball.
- Detect real bat-to-ball contact using the bat's movement and the ball's movement. A swing alone must not count as a hit.
- Let swing speed, direction/angle, timing, and contact accuracy affect the result and hit strength.
- Handle the basic game loop: balls, strikes, outs, fouls, walks, strikeouts, runs, innings, and changing sides after three outs. Use simple, consistent hit and base-running outcomes; a full fielding simulation is not needed for V1.
- Start with one fastball. Keep the pitch speed and timing consistent enough to learn, with modest variation in target location.

## V1 field and camera

- Use a sparse 3D scene. Keep the ground, bases, home plate, strike zone, batter, pitcher, bat, and baseball.
- Remove bleachers, crowds, fielders, other background players, and decorative background elements.
- Keep the view close to the batter, directly behind or just to the batter's right. The pitcher should be visible slightly left of the batter and the view should clearly show the incoming ball, bat movement, home plate, and strike zone.
- Keep all play in this batter's view. Do not switch to a pitcher camera or show a separate pitching animation.

## Character and bat appearance

- Make the players simple, rounded characters with capsule-like, bean-shaped bodies.
- Give each character a separate spherical head with a visible gap above the body, so the head appears to float.
- Keep character details simple. Do not add detailed uniforms or extra decorations that distract from the batting action.
- Orient the bat correctly: its narrow handle is at the player's hands and its thicker barrel is at the hitting end.

## iPhone motion controls

The phone should act as the player's bat. Scanning the QR code shown by the computer should open the phone controller and connect it to that game automatically. Avoid requiring the player to type a computer address except as a fallback.

Motion setup is automatic after pairing:

1. The player scans the computer's QR code with their iPhone and enables motion sensors.
2. The first sensor reading automatically becomes the neutral pose; no capture steps or manual recalibration are needed.
3. Show a live 3D phone visualization with angle/readout feedback on the computer, not the iPhone.

During play:

- The bat should copy the live phone preview's motion. Increasing roll rotates the bat clockwise from the batter camera; decreasing roll rotates it counterclockwise. A forward swing should trigger a controlled swing arc through the hitting zone.
- A held phone angle must remain fixed in the game after movement stops; never recenter the bat merely because sensor events pause. Filter small sensor jitter without snapping to another orientation.
- A forward phone swing should move the bat through the ball. Use motion/orientation and rotation speed to estimate bat pose, swing direction, timing, and speed.
- Finish each swing animation before returning the bat to its ready pose, then give the batter about 3.5 seconds to reset before the next pitch. Allow a forgiving early/late contact window so small timing errors can still connect.
- The phone page needs sensor permission, connection status, and a swipe-to-swing fallback. iPhone motion access may require a trusted HTTPS page; explain that setup clearly.

## Other controls and interface

- Keep keyboard and mouse controls as a fallback so the game can be played without a phone. A touchscreen swing control is also useful.
- Keep the main menu minimal with only Play and Connect Phone. Play starts the default practice game directly; pause and return-to-menu controls remain available during play.
- Do not show the score in the gameplay HUD or game-over screen. Keep balls, strikes, outs, pitch/result feedback, and phone connection state visible.
- Use fictional teams. Team abilities or different player statistics are not required for V1.

## Implementation constraints

- Use Three.js for the field and gameplay objects, HTML/CSS for menus and HUD, and modular JavaScript for gameplay, controls, rules, and phone communication.
- Use a local phone-to-computer connection such as WebSockets. Keep the QR pairing flow automatic and local.
- Use free tools and libraries. Do not require paid services or Homebrew.
- Keep the code organized and provide beginner-friendly instructions for running the project.

## V1 is ready when

- The computer pitches a moving ball while the player stays at bat.
- The batter's view clearly shows the pitcher, ball, bat, plate, and strike zone against a sparse ground-and-bases scene.
- The simple capsule-body, floating-sphere-head characters and correctly oriented bat are visible.
- The iPhone connects by scanning the computer's QR code; its first sensor reading establishes neutral automatically while the computer shows the live 3D phone visualization.
- Moving and swinging the phone visibly controls the bat in multiple axes; increasing roll rotates it clockwise and decreasing roll counterclockwise, and a well-timed swing can produce actual bat-ball contact.
- Basic baseball counts and outcomes work, with keyboard/mouse and phone-swipe fallbacks if motion input is unavailable.
