# Turnstile spike (grok.com, Electron 44.6.0 / Chrome 152.0.7977.130, macOS arm64)

Harness: main.js + probe.js + run.sh (variant via VARIANT=A|B|C|D, DRIVE=1 clicks "Sign in", types a fake .invalid email, clicks "Continue" so grok mounts Turnstile). Raw: raw/*.json (drv-* = driven grok login, grok-* = idle grok, D.json = demo.turnstile.workers.dev with the always-pass test sitekey, not discriminating).
Not measured: real Chrome reference (not launched, by instruction), Variant D re-run with the STUN probe (killed), repeat runs (n=1 per variant), interactive click on the checkbox.

| Variant | iframe navigator.userAgent | iframe XHR/image UA header | Notification.permission in iframe | widget after 15 s |
|---|---|---|---|---|
| A product (debugger + Emulation override + ses.setUserAgent + deny handler) | `... turnstile-spike/44.6.0 Chrome/152.0.7977.130 Electron/44.6.0` (override NOT applied in OOPIF) | Electron/44.6.0 UA; sec-ch-ua lacks "Google Chrome" in xhr, has it on top-level script | denied | no token (len 0) |
| B = A + notifications/media check true | same as A | same as A | granted | no token |
| C session.setUserAgent only, no debugger, same deny handler | same Electron UA in iframe | same; sec-ch-ua Chromium only | denied | no token |
| D plain Electron (first driven run) | Electron UA everywhere | Electron UA | granted | token len 752 (pass) |

Top frame in A/B/C reports `Chrome/152.0.0.0` UA, so top and iframe disagree; iframe subFrame navigation request carries `Chrome/152.0.0.0`, its JS and later XHR carry `Electron/44.6.0`.
Iframe, all variants: userAgentData.brands = Not?A_Brand + Chromium (no "Google Chrome"), fullVersionList Chromium 152.0.7977.130, window.chrome keys = [] (real Chrome has app/csi/loadTimes), webdriver false, plugins 5. STUN probe in iframe (A/B/C): host + srflx candidates gathered, two err:701 (some servers failed); stun.cloudflare.com and stun.l.google.com resolve from the unsandboxed run (dscacheutil/dig).
Permission log counts for A: iframe challenges.cloudflare.com notifications x5 and media x3 denied, same as the owner's sites.log.

Verdict: H1 (permission denial) not supported: B grants and still fails. H3 (debugger) not supported: C has no debugger and fails identically. Supported: the UA customisation itself (H2): any variant that spoofs the UA leaves the cross-origin Turnstile frame with an Electron UA in JS/XHR while the navigation request and the top frame claim Chrome/152.0.0.0; only D, with no spoof, passes. Caveat: n=1, D's pass came from the first (pre-STUN) driven run; window.chrome shape unchanged between D and the failing variants so it is not the discriminator here.
