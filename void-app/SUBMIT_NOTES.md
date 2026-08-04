# eas.json submit notes

Moved out of `eas.json` because EAS rejects unknown keys: a `"//"` comment key
in `submit.production.*` fails schema validation with
`"submit.production.android.//" is not allowed` and blocks *every* build
command, not just submits.

- **ios** — Fill from your Apple Developer account before `eas submit -p ios`.
- **android** — Play: place your service-account JSON path here. Samsung Galaxy Store: upload the same AAB via Seller Portal (no eas submit target — manual).
