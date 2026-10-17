# CardPulse

**Organize credit card statements, reconcile transactions, and estimate cashback in your browser.**

[简体中文](README.md) · [繁體中文](README.zh-TW.md) · **English**

CardPulse processes credit card PDF statements locally. Import a supported statement to filter transactions by merchant, currency, or direction, check whether statement balances reconcile, and estimate cashback using the built-in rules. To keep your records, encrypt and save them in your current browser with a master password.

It is designed for people who want to organize several months of statements while keeping transaction details on their own device. Workspaces cover HSBC, BOCHK, CNCBI, Hang Seng, Standard Chartered, Citi, DBS, and other banks. HSBC has a parser for specific PDF layouts; every bank supports standard CSV transactions and custom campaigns.

[Quick start](#quick-start) · [Using CardPulse](#using-cardpulse) · [Supported features and formats](#supported-features-and-formats) · [Privacy and data](#privacy-and-data) · [Development and contributions](#development-and-contributions)

## What it does

- **Organize transactions**: Import PDFs / standard CSVs in batches and view transaction dates, merchants, currencies, amounts, and detected payment channels. Search, filter, and export to CSV.
- **Check statement balances**: Reconcile each currency using “opening balance + debits − credits = closing balance,” with a status and any difference shown.
- **Estimate cashback**: Apply the built-in Pulse base and bonus rules, and track annual and half-year spending allowances. Refunds reduce rewards without restoring used allowances.
- **Save encrypted records**: Store encrypted transactions, statement summaries, and campaign configurations in the current browser. Restore them with your master password after reloading, or manually lock or clear the vault.
- **Reduce import mistakes**: Detect repeated PDF content and flag parsing issues and unsaved changes.

## Quick start

Install Node.js and npm; **Node.js 22.13 or later** is recommended. Your browser must support Web Crypto, Web Workers, and IndexedDB. Access the app through its local development address or HTTPS.

```bash
git clone https://github.com/leeeway/CardPulse.git
cd CardPulse
npm ci
npm run dev
```

Open the local address printed in your terminal, usually `http://localhost:5173`. To try the app without a real statement, select **“查看示例数据”** (View sample data).

## Using CardPulse

1. **Import statements**: Choose the import bank and card, then upload a PDF or standard CSV. Encrypted PDFs prompt for a PDF password. Cancel to skip that file and continue with the rest.
2. **Check the results**: Review transactions, detected payment channels, warnings, and each statement’s reconciliation status. Compare uncertain records with the original PDF.
3. **Review cashback estimates**: The dashboard summarizes eligible records from the start of the current year through today. HKD rewards are converted using a public reference exchange rate. If the rate is unavailable, affected CNY totals are shown as unknown.
4. **Save your records**: Select **“保存到加密库”** (Save to encrypted vault). Set a master password on the first save, then use the existing password for updates. **Importing does not automatically save your records.**
5. **Restore or export**: Unlock the local vault when you return. CSV exports contain only the currently filtered transactions.

Reconciliation statuses:

| Status | Meaning | Suggested action |
| --- | --- | --- |
| Matched / 对账一致 | Extracted opening and closing balances agree with the net transactions | Still spot-check categories and payment channels |
| Mismatch / 对账不符 | The calculated closing balance differs from the statement balance | Check for missing transactions or incorrectly extracted amounts and balances |
| Unverified / 未验证 | An identifiable opening or closing balance is missing | Check against the original PDF manually |

A matched balance confirms arithmetic consistency. It does not confirm transaction categories, payment channels, or bank reward eligibility.

## Supported features and formats

| Item | Current support |
| --- | --- |
| HSBC Pulse | Parses CNY / HKD transactions in supported statement layouts and estimates cashback using the built-in rules |
| HSBC Red | Card and channel detection in supported PDF layouts; custom campaigns can estimate rewards without applying Pulse rates |
| Text PDFs | English `POST DATE` / `TRANS DATE` headers, English month names, and fixed relative column positions; the currency must be unambiguous above the table header |
| Scanned / image PDFs | Not supported yet; OCR is not implemented |
| Encrypted PDFs | Local password entry and retries after an incorrect password |
| Import limits | PDF: up to 25 MB and 200 pages per file; standard CSV: up to 5 MB and 10,000 transactions per file |
| Documentation and interface languages | Documentation is available in Simplified Chinese, Traditional Chinese, and English; the application interface supports instant switching between Simplified and Traditional Chinese |

**Reward rules are an estimation model.** The app does not automatically verify current bank terms, promotion registration, merchant eligibility, or individual account conditions. See the [Pulse configuration](src/core/rules/hsbc_pulse.js) and [calculation engine](src/core/rewards.js) for the implemented rules. Actual rewards are determined by the bank.

Duplicate detection uses the PDF’s original bytes. Renaming an identical file does not bypass detection. Different PDFs containing overlapping transactions still require manual review. Older vault records lack file fingerprints and statement summaries, so check for duplicates before reimporting them.

Parser compatibility has been checked with synthetic data. More redacted real statement samples are needed to cover layout variations. Review extracted results when using an unsupported format.

## Banks, appearance, and custom campaigns

Use the header to switch between Simplified and Traditional Chinese, and choose Midnight Blue, Light, Ruby, or Jade. Only language and theme preferences are stored in local preferences; transaction and campaign data are excluded. Bank tiles filter the workspace. The import bank is selected separately in the upload section.

### Importing other banks

BOCHK, CNCBI, Hang Seng, Standard Chartered, Citi, DBS, and other banks currently support **standard CSV**, rather than native bank PDFs or bank-specific CSV exports. Select the CSV template download button and normalize your records into this format. CSV imports do not verify opening or closing balances. The viewing/export CSV uses a different format from the import template.

```csv
day,transactionDay,description,amount,currency,direction,category,last4,channel
2026-10-01,2026-10-01,EXAMPLE SHOP,100.00,HKD,debit,spend,1234,online
```

Required columns are `day`, `description`, `amount`, `currency`, and `direction`. Dates use `YYYY-MM-DD`; currencies are `HKD` / `CNY`; amounts are positive, with direction set to `debit` / `credit`. Optional categories are `spend`, `credit`, `repayment`, and `fee`. Channels are `standard`, `applePay`, `unionpayQr`, `online`, `supermarket`, `other`, `baseOnly`, and `exclude`. Store only the last four card digits. Standard CSV deduplication is scoped to the selected bank and card, so identical records from different banks remain separate. An invalid row rejects the entire file with a row number.

### Configuring reward estimates

Select Add campaign and configure the bank, card or last four digits, currency, dates, cash reward percentage, channel, and merchant keyword. Choose the entire campaign, calendar month, half-year, or calendar year as the period. Optionally set spending caps, reward caps, and minimum net spending per period. Estimates are calculated only after you confirm eligibility and registration requirements. Campaign additions, edits, and deletions require a manual vault save.

- Spending and reward caps apply per period. Blank means unlimited; `0` means zero allowance.
- Thresholds use net spending from matching records in that period. You verify eligibility; the app does not infer MCC, location, or bank registration from merchant names.
- Choose posting or transaction date. Records without a transaction date are excluded when using that date basis.
- Refunds reduce rewards in the period selected by that date basis, without restoring spending allowances. The reward cap is applied before refund clawbacks, so refunds do not refill capped rewards. Cross-period original transaction matching is not implemented.
- Each campaign calculates one currency. Percentage rates accept up to two decimal places. Calculations use fixed-point integers, with displayed rewards rounded to cents.
- Campaign estimates are independent. The app does not add them together or decide whether they stack with other campaigns or Pulse rewards. Search filters only affect the transaction table and CSV export, not campaign matching.

**Extension assessment:** Flat rates, caps, calendar periods, and thresholds fit a shared configuration model and are implemented. Points/miles conversion, tiered rates, statement cycles, cross-period refund matching, shared principal/supplementary allowances, and stacking need dedicated models. Native bank PDFs also need layout fixtures and reconciliation checks. For example, the [official Standard Chartered Smart page](https://www.sc.com/hk/credit-cards/smart/) describes statement-cycle spending, which cannot be replaced with calendar months. Bank links provide official references for manual checking, not verified reward presets.

## Privacy and data

- **Statements are processed locally**: The application has no business backend that receives statements. PDF parsing and cashback calculation run in your browser.
- **Saved data is encrypted**: Web Crypto derives a key with PBKDF2 (SHA-256, 100,000 iterations), then encrypts the data with AES-256-GCM. Ciphertext is stored in IndexedDB. The master password is neither uploaded nor persisted.
- **Unlocked records are readable in memory**: Transactions remain in application memory while unlocked. Locking clears the current transaction and statement state; the next unlock restores the last saved version.
- **Public exchange rates require a network request**: The app requests an HKD/CNY reference rate from [Frankfurter](https://api.frankfurter.dev/v2/rate/HKD/CNY), without sending statement content, using `credentials: 'omit'` and `referrerPolicy: 'no-referrer'`. Local statement processing does not mean the entire app makes no network requests.
- **The vault belongs to the current browser and site address**: Changing devices, browsers, or site addresses does not sync records automatically. A forgotten master password cannot be recovered, and clearing site data may delete the vault.
- **CSV files are plaintext**: Export escapes cells that could trigger spreadsheet formulas, but transaction details remain directly readable. Store exported files appropriately.

“清空数据” (Clear data) deletes current transactions, campaigns, and the local vault after confirmation. “锁定保险库” (Lock vault) prompts before discarding unsaved changes; saved records remain.

## Development and contributions

The project uses React, Vite, and PDF.js, with no business backend.

```bash
npm test          # Run the native Node.js test suite
npm run build     # Build static assets into dist/
npm run preview   # Preview the production build locally

# Optional: install the browser and run end-to-end regression tests
npx playwright install chromium
npm run test:browser
```

Deploy the static assets to a host that supports HTTPS. For deployment under a subpath, configure Vite’s `base`. For example, a GitHub project site can use `npm run build -- --base=/CardPulse/`.

A [GitHub Actions CI template](docs/ci.yml) covers tests and builds on Node.js 22/24. It is not enabled yet. With the required repository and workflow permissions, place it at `.github/workflows/ci.yml` to enable it.

Main modules:

| Path | Responsibility |
| --- | --- |
| [`src/App.jsx`](src/App.jsx) | Import, filtering, dashboard, and vault interactions |
| [`src/core/pdf.js`](src/core/pdf.js), [`statement.js`](src/core/statement.js) | PDF text extraction, coordinate parsing, and statement summaries |
| [`src/core/reconciliation.js`](src/core/reconciliation.js) | Amount conversion and balance verification |
| [`src/core/rewards.js`](src/core/rewards.js), [`rules/`](src/core/rules/) | Cashback estimation and card rules |
| [`src/core/crypto.js`](src/core/crypto.js), [`storage.js`](src/core/storage.js) | Encryption and IndexedDB persistence |
| [`tests/`](tests/) | Regression tests for parsing, precision, rewards, storage, and export |

Report issues or propose improvements through [Issues](https://github.com/leeeway/CardPulse/issues). For parsing problems, include the bank and card type, expected result, and a redacted layout example. Do not publish real card numbers, names, transaction details, or PDF passwords.

When changing features, support coverage, or usage steps, update all three language editions and keep their section order and feature status aligned. Include redacted or synthetic regression cases when adding a card type or parsing rule.

## Planned work

These features are not implemented and are outside the current support scope:

- Expand redacted statement fixtures and improve layout compatibility.
- Verify official campaign rules, add native statement adapters, and model points, tiered rates, and statement cycles.
- Add local OCR for scanned statements.
- Support Beancount / Ledger export.
- Add a spending strategy simulator.

## License and disclaimer

This project is released under the [MIT License](LICENSE). CardPulse is an independent community tool and is not officially affiliated with HSBC or any other card issuer. Parsing and cashback results are provided for checking and reference. The bank’s official statements, promotion terms, and final postings take precedence.
