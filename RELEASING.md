# Releasing the PartnerIQ SDKs

`@partneriq-io/shared-types`, `@partneriq-io/node` and `@partneriq-io/browser` are released together, with one version number, by [`.github/workflows/release.yml`](.github/workflows/release.yml).

Publishing uses **npm trusted publishing (OIDC)**. No npm token exists anywhere: when the workflow runs, GitHub issues a short-lived identity token, npm checks that it came from this repository, this workflow file and the `npm-publish` environment, and only then accepts the publish. Every release carries signed [provenance](https://docs.npmjs.com/generating-provenance-statements), shown on npmjs.com as "Built and signed on GitHub Actions".

## How a release is protected

| Control | Where |
| --- | --- |
| No long-lived npm token to leak | npm trusted publisher (OIDC) |
| Only this repo + `release.yml` + `npm-publish` environment can publish | npm trusted publisher settings |
| A person approves every publish | GitHub environment `npm-publish` → required reviewers |
| Only a `vX.Y.Z` tag on a commit already on `main` publishes | `release.yml` "Release must come from main" check |
| Tag must equal all three package versions | `release.yml` version check |
| Publishes exactly the tarballs that passed tests (checksummed) | `verify` → artifact → `publish` |
| Publish job runs no repository code and no install scripts | no checkout, `--ignore-scripts` |
| `id-token: write` only in the publish job, nothing granted by default | `permissions: {}` at workflow level |
| Third-party actions pinned to commit SHAs, kept current | workflow files + `dependabot.yml` |

## One-time setup

### 1. GitHub repository

1. Create `venkat1705/partneriq-sdk` on GitHub, then push:
   ```bash
   git remote add origin https://github.com/venkat1705/partneriq-sdk.git
   git push -u origin main release/v1.1.0
   ```
2. **Settings → Environments → New environment** `npm-publish`:
   - **Required reviewers**: add yourself (and a second maintainer if you have one). Turn on **Prevent self-review** if there are two.
   - **Deployment branches and tags**: choose *Selected branches and tags* and add the tag rule `v*`.
3. **Settings → Rules → Rulesets**:
   - Branch ruleset for `main`: require a pull request, require the **CI** status checks, block force pushes and deletion.
   - Tag ruleset for `v*`: restrict creation, update and deletion to maintainers, so nobody else can trigger a release.
4. **Settings → Actions → General**: *Workflow permissions* = **Read repository contents**. Leave *Allow GitHub Actions to create and approve pull requests* off.

### 2. First publish of `@partneriq-io/shared-types` (once)

npm can only attach a trusted publisher to a package that already exists, and `shared-types` has never been published. Publish 1.1.0 once by hand from the release commit:

```bash
npm login                     # an account with 2FA enabled
npm run build:shared-types
npm publish --workspace shared-types --access public
```

The release workflow then sees `@partneriq-io/shared-types@1.1.0` already exists and skips it. `node` and `browser` already exist (1.0.1), so they need nothing extra.

### 3. npm trusted publishers

On npmjs.com, open each package (`@partneriq-io/node`, `@partneriq-io/browser`, `@partneriq-io/shared-types`) → **Settings → Trusted Publisher → GitHub Actions**:

| Field | Value |
| --- | --- |
| Organization or user | `venkat1705` |
| Repository | `partneriq-sdk` |
| Workflow filename | `release.yml` |
| Environment name | `npm-publish` |

Then, still under each package's **Settings → Publishing access**, choose **Require two-factor authentication and disallow tokens**. Trusted publishing keeps working; any leaked or forgotten token stops working.

### 4. Remove the old token

Delete the `NPM_TOKEN` repository secret if it was ever added, and revoke the matching token under npmjs.com → *Access Tokens*. Nothing uses it any more.

## Releasing a version

1. On a branch `release/vX.Y.Z`: bump `version` in all three `package.json` files to the same value, update each `CHANGELOG.md`, and run `npm install --package-lock-only`.
2. Run `npm run test:sdk`, open a PR to `main`, and merge once CI is green.
3. Tag the merge commit on `main` and push the tag:
   ```bash
   git switch main && git pull
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```
4. In **Actions → Release**, review the `verify` job and approve the `npm-publish` deployment.
5. Check the packages on npmjs.com show the new version with provenance.

A version like `1.2.0-beta.1` (tag `v1.2.0-beta.1`) is published under the `next` dist-tag, so `npm install` users keep getting the stable release.

**Rehearsal:** *Actions → Release → Run workflow* runs everything except publishing (tests, pack, `npm publish --dry-run`). It never publishes.

**A run failed halfway?** Re-run it. Versions already on npm are skipped.

**Something bad was published?** Deprecate it rather than unpublishing: `npm deprecate @partneriq-io/node@X.Y.Z "reason"`. Then release a fixed patch version.
