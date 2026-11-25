# Sochrome

Sochrome reads a whole-genome file on your own device and shows what each rare change in about 2,100
condition-linked genes does to the gene's protein. Designed and built by Ashwin Mukherjee, 2026.

It is not a medical device and gives no clinical or diagnostic advice.

## What happens to a genome file

Your file is read in this browser, on this device. Nothing from it, or worked out from it, is sent
anywhere. The app downloads the same reference data for everyone, so the download says nothing about
you. Your browser keeps that reference data to make the next visit faster; it keeps nothing from your
file after you close the page.

That is a description of what the code does, and `npm run verify` proves it (the leak test, check P1).
If the code ever changes, this statement changes in the same commit.

## Run it

```
npm install
npm run dev        # the app, at localhost:5200
npm run verify     # every check
npm run build      # the static site, in dist/
```

Node 22 or later. The checks that open a browser use the Chrome installed on this machine.

## Data

The reference data bundle is built from public sources and is not in this repository:
`public/data/` is gitignored. `npm run bundle` builds it from the packed tables, and
`THIRD_PARTY.md` lists every source with its licence.

## Typefaces

The app is set in Suisse Intl, Suisse Works and Suisse Mono (Swiss Typefaces), which are commercial.
Their files are never in this repository: put them in `fonts/` (gitignored), and a build copies them
into `dist/fonts/` (the `.woff2` files only). A build fails if they are missing. Whoever shares a build
needs a licence that covers the site it is served from; the owner's licence terms sit beside the files.

The typeface is one token, `src/typeface.ts`. Setting it to `"standin"` builds with free faces
(Inter, Source Serif 4, IBM Plex Mono) and ships no commercial file.

## Where things are

- `src/brand.ts` holds the product's name. Nothing else states it.
- `src/contracts/` holds the types every module shares and every shared number.
- `src/spine/` reads variants into facts; `src/worker/` and `src/data/` run it in the browser.
- `src/render/` draws; `src/copy/` says; `src/ledger/` and `src/app/` are the pages.
- `tools/` builds the data and runs the checks.

## License

You may read, run, and learn from this. You may not use it commercially or redistribute modified
content. For anything else, contact hello@sochro.me.

- Code: [PolyForm Noncommercial 1.0.0](LICENSE).
- Copy, narrative text, graphics and visual design: [CC BY-NC-ND 4.0](LICENSE-CONTENT).
- Data, models, fonts and dependencies keep their own licences: [THIRD_PARTY.md](THIRD_PARTY.md).

Copyright 2026 Ashwin Mukherjee.
