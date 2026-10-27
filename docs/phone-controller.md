# Phone controller

Use your phone as a physical-feeling control yoke while the simulator runs on your computer. No app
to install and nothing to configure — both ends are just web pages.

## Pairing

1. On the computer, open [flight mode](https://0sfs.github.io/fly/), then ⚙ → **Remote Control**.
2. Scan the QR code with your phone camera.
3. On the phone, tap **Take control** in the chip grid to join the shared controls with phone priority.

A controller added to the Home Screen opens without an invitation, because the Camera app sends a
scanned link to the browser rather than to the installed app. It pairs by reading the QR itself:
tap **Scan QR code** and point the phone at the computer. A session that has ended offers the same
button in the chip grid and under its cause in **Connection details**. The browser opens the camera only on a secure page, so this works on the
deployed site and under `npm run dev:lan`, not over plain HTTP. A QR for this same page pairs in
place, without the invitation ever reaching the address bar; a QR for another copy of the site
loads that copy, as the Camera app would, so the phone runs the code the computer runs.

A phone that is on the simulator instead — opened at `/fly/`, or from a Home Screen icon made there —
becomes the controller from the same tab: **Switch to RC mode** opens `/rc/` in its place. On a phone
the tab leads with that button and makes no QR until asked. The icon still opens the simulator next
time; an icon made from `/rc/` is named *0SFS RC* and always opens the controller.

**Take control** selects that device's priority and preserves the simulator's pause state.
If the flight is paused, tap **▶** (Resume) in the grid separately. The touch controller provides
pitch/roll, rudder, throttle, trim, flaps, brake, pause, and camera view.

The controls sit where the desktop flight HUD puts them, so muscle memory carries between
the two screens: the pitch/roll stick with roll trim above it, pitch trim on its left, the flaps lever
on its right, and the trim-centring buttons in the corner above pitch trim; then yaw, brake and the
throttle lever as the second group.

On both screens, the round amber slider handle and its percentage show the command.
A white I-beam marks the aircraft's actual position when it differs: flap travel,
throttle position and yaw, plus the desktop's VTOL conversion lever. Hover or focus
a slider to read both values. Unknown positions have no marker; the current models
do not expose independent physical trim positions. Position feedback never moves
the command handle or takes control.

The controller page never scrolls. It is sized to the viewport so a control cannot move out from
under a thumb mid-flight, and everything secondary collapses to make room: the instruments, the link
state and every button share one compact chip grid below the controls (or above them, from ⚙
Settings), and **Connection details** and **Settings** open as full-screen sheets instead of growing
the page. A phone in portrait is too narrow to hold both of the desktop HUD's bottom corners
side by side, so the two groups stack there, each keeping its own internal geometry; in landscape and
on wider screens they sit side by side exactly as the desktop does.

The QR expires after two minutes and admits one phone. Leaving the tab hides it; **Disconnect**
invalidates the invitation or ends the session.

### Shared controls and priority

Once the phone joins, the computer's keys, gamepad and HUD and the phone's controls stay live together.
A key pressed on the computer does not disconnect the phone or change priority. Both devices have a
**Take control** button: on the phone it selects phone priority; in the computer's Remote Control tab
it selects computer priority. The phone's status chip reads **Phone priority** or **Computer priority**.
The same choice is in Remote Control → **Shared controls** → **Control priority**.

- Pitch, roll, rudder and brake mix. The priority device gets its input, and the other gets whatever
  authority that leaves free. A full deflection on the priority device is all of the control; a centred
  control leaves the whole range to the other device.
- Throttle, trim and flaps go where either pilot last moved them. The priority device wins when both
  move the same lever at once. Both screens follow the resulting command; a hardware lever resting
  elsewhere waits until it is moved again.
- Switching priority keeps the phone's held inputs and camera gestures active. It needs no new pairing,
  centring step or handoff. Pausing also keeps both devices connected. Hiding the computer's flight
  tab pauses the simulation and keeps the phone connected; resume explicitly when the tab returns.

Older saved choices for exclusive control or automatic takeover no longer change this model.
**Disconnect** in the computer's Remote Control tab ends the session deliberately.

### When the link drops

Wi-Fi, a busy phone or a busy computer can hold up the link for a moment. Nothing pops up:

- The computer holds the phone's last command — including a held stick, rudder, brake or starter —
  during a gap of up to five seconds. Heard again within that time, the phone carries on with the same
  priority and controls.
- The phone's controls stay live, and its **🌐** chip counts how long the computer has gone unheard,
  in place of the round trip. This warning does not change priority.
- Only a gap longer than five seconds removes the phone's input. The stick, rudder, brake and starter
  then let go; persistent levers stay where they were, and the computer continues without a pause.
  The phone can join again when its connection recovers. A broken session or an incompatible protocol
  may require a new QR.
- The computer stalling — compiling shaders as an engine lights, for example — does not count as the
  phone's silence, and the phone stalling does not count on its 🌐 chip.

Both ends keep each loss and its duration in **Connection details**. Hiding the controller — locking
the phone or switching apps — sends a centred frame first, so the computer holds nothing deflected.
Returning within five seconds preserves the connection.

## When pairing fails: read the connection details

Both ends keep a timeline of the whole attempt, and both show it. On the phone it is the
**🌐** chip in the controller's grid, which shows the round trip — or, lit, how long the computer has
gone unheard — and opens **Connection details**; on the computer it is **Connection
details** inside the Remote Control tab. Either one opens itself when something fails, shows the
cause at the top, and has a **Copy diagnostics** button that produces a plain-text report suitable for
a bug report.

The report answers the questions that actually decide a pairing failure:

| Line | What it tells you |
| --- | --- |
| `signaling` | Whether this device registered with the pairing service, how long it took, and the PeerJS error type if it did not |
| `local candidates` / `remote candidates` | How many addresses each side offered, by type (`host`, `srflx`, `relay`), and how many were mDNS `.local` names |
| `ice server error` | A STUN or TURN server that answered with an error while gathering |
| `selected pair` | The path that was actually chosen, or `none` |
| `channels` | When the session channel and the low-latency control channel opened |
| `failure` | The first recorded cause, which is the one worth reading |

Common shapes:

- **`peer-unavailable`** — the QR expired, or the computer's tab was closed or reloaded after the QR
  was shown. Create a new QR. This is reported immediately rather than after a timeout.
- **remote candidates `none`** — nothing ever arrived from the other device. It is still gathering, was
  closed, or its signaling dropped before it answered.
- **both sides only `mdns`** — the two browsers could not resolve each other's `.local` names. On
  macOS and iOS this is the **Local Network** permission; allow it for the browser and pair again.
- **candidates on both sides, no `relay`, no selected pair** — there is no direct path between the two
  devices. Access points with client isolation ("AP isolation", most guest networks) and routers that
  will not loop a connection back to themselves both land here. Only a TURN relay gets through it; see
  below.

Addresses in the report are masked to their subnet (`192.168.1.x`), and mDNS candidates are labelled
rather than printed, so a report can be shared without publishing a device's full address.

## Requirements and limits

Pairing uses PeerJS Cloud for signaling. Flight inputs then travel over a direct WebRTC data channel
configured with `ordered: false` and `maxRetransmits: 0`, so a late packet is dropped rather than
delaying the ones behind it.

Both pages are static GitHub Pages assets; there is no application server, local helper, or tunnel.
Internet access is needed for page loading and initial signaling.

By default the connection uses STUN only — several independent STUN hosts, so one blocked or
rate-limited server costs gathering time rather than the connection. STUN discovers addresses; it
cannot carry traffic. Where no direct path exists between the two devices, a TURN relay is the only
option.

The phone and desktop must run the same protocol version — reload both after an update.

## Adding a TURN relay

A TURN server relays the flight-control traffic when the two devices cannot reach each other
directly. Both ends need the same configuration.

At build time — one setting reaches both devices, because they load the same bundle:

```sh
VITE_ICE_SERVERS='[{"urls":"turn:turn.example.org:3478","username":"user","credential":"pass"}]' npm run build
```

Per device, without rebuilding, in the browser console on each of the two devices:

```js
localStorage.setItem('osfs.ice-servers', '[{"urls":"turn:turn.example.org:3478","username":"user","credential":"pass"},{"urls":"stun:stun.l.google.com:19302"}]')
```

The device setting overrides the build setting. Include a STUN entry alongside TURN so a direct path
is still preferred when one exists — the **Connection** line in the diagnostics panel reports whether
the session ended up direct or relayed. An invalid or partly invalid list is ignored in full rather
than half-applied, and the diagnostics report names which servers were used with credentials stripped.

Running your own TURN server (`coturn` is the usual choice) keeps the flight data on infrastructure
you control; a third-party TURN provider will see the relayed traffic.

## Where the QR points

The QR points at **the site the desktop is already on** — same origin, same base path, plus `/rc/`.
A fork served from anywhere needs no configuration for this, and a locally served copy pairs with a
phone without being deployed first.

Two exceptions:

- **Loopback.** A phone cannot reach `localhost`, so a QR must never offer it. The dev server reports
  the address other devices can use, and the QR is built from that instead. A browser cannot discover
  its own LAN address — WebRTC stopped exposing it — so this only works when a dev server has supplied
  one; see [Development](https://github.com/0SFS/fly/blob/main/docs/development.md#testing-on-a-real-phone). Without one, creating a QR fails and
  names the command to run rather than producing an unreachable link.
- **`VITE_PHONE_CONTROLLER_URL`.** Set at build time, it overrides the origin entirely, for a
  deployment whose QR has to point somewhere else. See [Deploying to GitHub Pages](https://github.com/0SFS/0SFS.github.io/blob/main/docs/deploying.md).

Invitations require HTTPS, with one carve-out: plain HTTP is accepted when the host is a private
address (loopback, `10.x`, `192.168.x`, `172.16–31.x`, IPv6 unique- and link-local). That is what a
laptop serving its own LAN looks like, and requiring a certificate there would mean no testing on a
real phone without one. A deployed site is never on such a host, so a published QR is always HTTPS.

The phone route loads independently of the globe renderer and JSBSim, so it stays lightweight on
mobile data.

## The screen itself

The phone flies the aircraft, moves the chase camera from a trackpad — swipe to look, pinch to zoom —
and shows the desktop HUD's own engine widget, drawn by the same code from the same reading, just
above the throttle. Where the browser can hide its own bars it asks once, in a popup, and keeps a ⛶
button in its grid after that. On an iPhone, where Safari has no page fullscreen at all, that popup
explains why rather than only saying "add it to your Home Screen": what the bars cost, that nothing
is missing or for sale, the three options that exist, and — folded away for whoever wants it — the
whole technical case, including why another browser on the same phone changes nothing. ⚙ Settings moves the chip grid above or below the controls, and decides whether the
yaw slider returns to centre when you let go — and how long that return takes — or keeps the
deflection until you move it again.

Those settings and **Haptics** are kept on the computer too, with its own, in Remote Control →
**Phone controller**, so an export or a preset made on the computer carries them, and either screen
can change them. At pairing the computer's values win, except where it still has its default: there
the phone's own choice is kept, so a phone set up before the computer kept them loses nothing. The
phone keeps a copy for when it is not paired. A computer that predates this sends nothing, and the
phone keeps its own.

Right of the 🌐 chip, the **Hz** chip shows how many control frames the phone sent in the last
second: the touch rate while a finger moves, the 60 Hz timer while none does, and 0 while the
computer flies. Connection details shows the same number as **Control frames sent**.

[Phone controller UI](phone-controller-ui.md) covers how the page is built: the stylesheet it shares
with the desktop HUD, the OLED theme, the control arrangement in each orientation, and the layout
rules `npm run check:phone-layout` enforces.

**Defects found on a real iPhone** — see [the session record](ux/2026-09-17-iphone-session.md):

- **A vertical drag on a slider scrolled the page instead of moving the control**, which made the
  throttle unusable. Every flight slider now carries `touch-action: none` in the shared
  `flightControls.css`, and the phone page no longer rubber-bands. **Not yet confirmed on a
  device** — the layout check passed before the fix too, because a geometric check cannot see a
  stolen gesture.
- **Add to Home Screen from `/rc/` installed the flight simulator.** `/rc/` now links its own
  manifest, `public/rc.webmanifest` — *0SFS RC*, opening `/rc/` — chosen by the boot script in
  `index.html`, so the controller and the simulator install as two icons.
- **`/fly/` said almost nothing about fullscreen on a phone.** It now shows the controller's own
  notice on an iPhone: the same component, words and card.
- **An installed controller could not pair.** The invitation arrives in the QR link's hash and is
  cleared as soon as the page reads it, and iOS opens a link from the Camera app in Safari, never
  in a Home Screen app — so the installed controller opened at *Scan a new QR to connect* with no
  way to take one. The controller now reads the QR itself: **Scan QR code** on that page, and in
  the chip grid of a session that has ended, opens the camera in the page. **Not yet confirmed on a
  device.**

Each page tints the browser bars its own background (`theme-color`, set per route by the same boot
script): true black on `/rc/`, the flight page's `#04060a` on `/fly/`.

There is no way to hide the iOS URL bar other than a Home Screen launch; the alternatives and why
each fails are tabulated in [the brainstorm](brainstorm/ios-url-bar-and-scrolling.md).

## Camera trackpad

How a swipe reaches the view is Remote Control → **Phone camera trackpad**, on the computer. The
defaults are the preset **Phone camera: recommended**, and they are smooth: they spend a little delay
to hide the uneven way Wi-Fi delivers frames, which otherwise shows as a camera that jumps.

| Setting | Default | The other choice |
| --- | --- | --- |
| **Phone sends** | Once per touch frame | On each touch and a 60 Hz timer: the original, about 10–17 ms later and less steady |
| **Lost or late frames** | Recovered from the gesture's running total, at no delay | Their movement is lost |
| **Draw movement** | Paced on the phone's own timeline, the **Playout buffer** (12 ms) behind the fastest delivery seen | As soon as it arrives: the lowest delay, and a jump for every uneven delivery |

For the lowest delay, set **Draw movement** to **As soon as it arrives**. **Phone camera: original**
is how the trackpad first worked: on a timer, losing lost frames, drawn on arrival. The costs quoted
come from simulated measurements, not from a device.

The camera glides as FOSS Earth's does, with the same setting: Aircraft → Camera → **Glide** on
the computer (FOSS Earth's `camera.inertiaDecay`, 0.82). It eases into each swipe and pinch, goes on
at the gesture's speed when the fingers lift, slowing to a stop, and stops where it is when a finger
lands on the pad again. A finger that rests before lifting has no speed left to glide with.
**Glide** 0 draws every movement at once. A phone that predates this does not say when its fingers
lift, so the computer ends its gesture once it has been still for 48 ms.

## Specification

[docs/proposals/phone-controller.md](proposals/phone-controller.md) has the control protocol, failure
behavior, and the device acceptance checklist. Real iPhone and Android testing on the deployed site is
still required before treating the feature as verified on those devices.
