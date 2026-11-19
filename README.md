# detect

Live mouse, touch and keyboard event detector, served at [detect.tkalve.dev](https://detect.tkalve.dev). Everything runs in the browser; nothing is sent anywhere.

## Development

```sh
cd app
npm install
npm run dev      # Vite dev server
npm run lint
npm run build    # typecheck + production build to app/dist
```

## Deployment

The built SPA is served as static assets by a Cloudflare Worker (`app/wrangler.jsonc`). Pushing to `main` runs `.github/workflows/deploy.yml`, which builds and deploys with Wrangler. It needs the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

Manual deploy: `cd app && npm run deploy`.

Security headers live in `app/public/_headers`; see [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

[MIT](LICENSE)
