// probe.js
(async () => {
  const out = {};
  const t = async (k, f) => { try { out[k] = await f(); } catch (e) { out[k] = 'ERR ' + e.message; } };
  await t('url', () => location.href.split('?')[0]);
  await t('userAgent', () => navigator.userAgent);
  await t('uaBrands', () => navigator.userAgentData && navigator.userAgentData.brands);
  await t('uaMobile', () => navigator.userAgentData && navigator.userAgentData.mobile);
  await t('uaPlatform', () => navigator.userAgentData && navigator.userAgentData.platform);
  await t('highEntropy', () => navigator.userAgentData.getHighEntropyValues(['fullVersionList','platformVersion','architecture','bitness','model','uaFullVersion','wow64']));
  await t('NotificationPermission', () => Notification.permission);
  for (const n of ['notifications','camera','microphone','geolocation','clipboard-read','midi'])
    await t('perm_' + n, async () => (await navigator.permissions.query({ name: n })).state);
  await t('webdriver', () => navigator.webdriver);
  await t('chromeKeys', () => Object.keys(window.chrome || {}));
  await t('chromeType', () => typeof window.chrome);
  await t('plugins', () => navigator.plugins.length);
  await t('mimeTypes', () => navigator.mimeTypes.length);
  await t('languages', () => navigator.languages);
  await t('hardwareConcurrency', () => navigator.hardwareConcurrency);
  await t('deviceMemory', () => navigator.deviceMemory);
  await t('platform', () => navigator.platform);
  await t('vendor', () => navigator.vendor);
  await t('mediaDevices', () => !!navigator.mediaDevices);
  await t('enumerateDevices', async () => (await navigator.mediaDevices.enumerateDevices()).map(d => d.kind));
  await t('screen', () => [screen.width, screen.height, screen.colorDepth, devicePixelRatio]);
  await t('outer', () => [outerWidth, outerHeight]);
  await t('tz', () => Intl.DateTimeFormat().resolvedOptions().timeZone);
  await t('webgl', () => { const c = document.createElement('canvas'); const g = c.getContext('webgl'); const e = g && g.getExtension('WEBGL_debug_renderer_info'); return e ? [g.getParameter(e.UNMASKED_VENDOR_WEBGL), g.getParameter(e.UNMASKED_RENDERER_WEBGL)] : null; });
  await t('uaFnToString', () => Function.prototype.toString.call(navigator.permissions.query).slice(0, 40));
  await t('stun', () => new Promise((res) => {
    const c = []; const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }] });
    pc.createDataChannel('x'); pc.onicecandidate = (e) => { if (e.candidate) c.push(e.candidate.type); };
    pc.onicecandidateerror = (e) => c.push('err:' + e.errorCode);
    pc.createOffer().then((o) => pc.setLocalDescription(o));
    setTimeout(() => { pc.close(); res(c); }, 6000);
  }));
  return out;
})()
