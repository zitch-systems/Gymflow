# query-string compatibility package provenance

This package contains the unmodified runtime and type sources from the official
`query-string@9.5.1` npm tarball, plus a two-line entry point that re-exports the
upstream named API for Expo Router 57's compiled CommonJS imports.

- Upstream: https://www.npmjs.com/package/query-string/v/9.5.1
- Tarball SHA-512: `sha512-/zO3RwuRCMTIcEgq6YMv4OrtEE1XzBG7w5N6zc6ydYnkWYOWsnLI/5894hYEzfESfMOT4cHCsRTIdxsSl1KjGg==`
- Tarball SHA-1: `aecdc091d3dc7ce293eed83957e220d523a3d0f7`
- License: MIT (`upstream/license`)
- Patched decoder: official `decode-uri-component@0.5.0`
- Decoder tarball SHA-512: `sha512-1BiQVoK8C9gUbQU6NzAtO/tkz2qOFpEObMWpcFvhx4fYnj4Oc5yzaJN/LD36ihkVUdXyh5ZekzX+yM+ty/SrPg==`
- Decoder tarball SHA-1: `4592fa1e1d640ec5e2760e2e168ad2ab5f2c9da1`

To verify the copied upstream files, unpack the npm tarball and compare
`base.js`, `base.d.ts`, `index.js`, `index.d.ts`, and `license` byte for byte.
Their SHA-256 digests are checked by `mobile/scripts/test-router-compat.mjs`:

| File | SHA-256 |
| --- | --- |
| `base.js` | `4fe40676faa0c35aa6f505d1b978fbf847a055059275a6f6ff335c8954abcf7e` |
| `base.d.ts` | `a5d4d717669b02251bd646beb5d4b067130baa179a9f2e0eb1b190f8a7f783bb` |
| `index.js` | `8415e586a8d05e147db1408009607aa99ad0d6b01ab8a974d071ba7f086cff98` |
| `index.d.ts` | `cfe2c5dd621bc76163cfa2dcb7c529c4764e0ea9adb1e1c8e42daf9f798df1c4` |
| `license` | `5c932d88256b4ab958f64a856fa48e8bd1f55bc1d96b8149c65689e0c61789d3` |
