# chat-sites@2026-10-21

What chatgpt.com, grok.com and chat.deepseek.com do inside Electron 44.6.0, observed 2026-10-21 with a temporary partition, logged out (`tasks/05-feasibility/01-evidence-table/spikes/web-report.json` and screenshots).

- chatgpt.com opens its chat page logged out, with an input and a microphone button; no bot challenge — https://openai.com/policies/row-terms-of-use/
- grok.com opens its chat page logged out with an input and a cookie banner; no bot challenge — https://x.ai/legal/acceptable-use-policy
- chat.deepseek.com redirects to `/sign_in`; with the Electron user agent it shows "Abnormal usage environment … we recommend using our official product", with the Electron token removed it shows the normal sign-in form (phone/email, Google, Apple) — https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html
- OpenAI terms: you may not "Automatically or programmatically extract data or Output" — https://openai.com/policies/row-terms-of-use/
- xAI acceptable use policy forbids "using bots to access" the service — https://x.ai/legal/acceptable-use-policy
- DeepSeek terms forbid "capturing, copying any content of the Services, including … using any robots, spiders … or other automatic setups" — https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html
- Google OAuth: "A developer must not direct a Google OAuth 2.0 authorization request to an embedded user-agent under the developer's control" — https://developers.google.com/identity/protocols/oauth2/policies
- Cloudflare challenges inside Electron views are reported for chatgpt.com (2023) and grok.com/deepseek (forum, unverified); none appeared in this run — https://community.openai.com/t/unable-to-use-chatgpt-in-an-electron-webview-request-for-cloudflare-restrictions-relaxation-for-electron-user-agent/164783
