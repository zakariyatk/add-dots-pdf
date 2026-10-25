# Store screenshots

The Microsoft Store and Google Play images in `design/store`, made from the real app.

1. `capture.mjs` prints the sample documents (`sample.html`, `plan.html`) to PDF, opens them in the web app in Edge and drives each feature, saving raw screens to `out/raw`.
2. `compose.mjs` lays each screen out as a store image: headline, laptop or phone frame, icon badge and a zoomed card.

```bash
npm run dev -w @adddots/web -- --port 5199
node scripts/store/capture.mjs all
node scripts/store/compose.mjs
```

The images land in `scripts/store/out/microsoft-store` (1920 × 1080) and `scripts/store/out/google-play` (1080 × 1920 phone screenshots and the 1024 × 500 feature graphic). Copy them to `design/store` when they are right.

- `assets/signature-dialog.png`: the signature used on the forms, taken from a real signature drawn in the app.
- `assets/site-photos/`: put real site photos here (jpg or png) and they are pinned to the plan in place of the drawn ones.
- Headlines and the order of the slides are the `DESK` and `PHONE` lists in `compose.mjs`; the accent colour is `BLUE` there (the app's #6A4BF0).
