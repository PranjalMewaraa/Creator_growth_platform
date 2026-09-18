# Spike: LinkedIn member posting in developer mode

**Question (plan section 11, week 1):** can we post to a team member's own LinkedIn profile with the self-serve "Share on LinkedIn" product, without app review?

**Answer: yes.** Run on 2026-09-18 with `spikes/linkedin-publish.ts --publish`. Test post: https://www.linkedin.com/feed/update/urn:li:share:7506627054684000256/ (safe to delete).

## What was run

| Step                | Call                                                                 | Result                                                               |
| ------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Identify member     | `GET /v2/userinfo` (OpenID Connect)                                  | `sub` gives the author URN, `urn:li:person:{sub}`                    |
| Register upload     | `POST /rest/images?action=initializeUpload` with the member as owner | Upload URL and `urn:li:image:…` in 0.4 to 0.5s                       |
| Upload bytes        | `PUT {uploadUrl}` with the JPEG body                                 | Done about 1s later                                                  |
| Wait for processing | `GET /rest/images/{urn}`                                             | `AVAILABLE` about 4s after registering                               |
| Create post         | `POST /rest/posts`, `visibility: PUBLIC`, image as `content.media`   | Created in 0.6s; the post URN comes back in the `x-restli-id` header |

End to end for one image post: about 5 seconds. Products enabled on the app: Share on LinkedIn (`w_member_social`) and Sign In with LinkedIn using OpenID Connect (`openid`, `profile`). The versioned REST calls used `LinkedIn-Version: 202608` and `X-Restli-Protocol-Version: 2.0.0`.

## What this means for the build

- **The self-serve products are enough for member posts.** No Community Management review is needed while we post as the member rather than as a company page.
- **The irreversible step is exactly one call.** Registering and uploading an image is private and safe to retry; only `POST /rest/posts` makes it public. Claim before call applies: set `publish_started_at` just before it, and keep the image URN in `prepared_ref` (A8, invariant 9).
- **LinkedIn takes the bytes, Instagram takes a URL.** LinkedIn needs no public media link. The two publishers differ in how media gets to the platform, which the `prepare` step of the `Publisher` contract already hides.
- **The API version must be kept current.** LinkedIn retires old monthly versions, so the `LinkedIn-Version` value belongs in config, not code, and needs a refresh before the demo.

## Open observation: not in the profile Activity list

Right after publishing, the post opened at its permalink but did not appear on the author's profile under Activity or Posts. The post exists and is live; the open question is whether it surfaces where people normally look, which the demo depends on.

The likely cause is LinkedIn indexing API created posts into Activity with a delay. To settle it: recheck `linkedin.com/in/<handle>/recent-activity/all/` after an hour, open the permalink in a private window to confirm it is public, and look for it in the home feed. If it still does not surface, post once through the older UGC Posts API to compare. That makes a second public post, so ask before running it. The app cannot read posts back (`w_member_social` is write only), so this can only be checked by eye.

## Not yet verified

- **Video.** It goes through the Videos API with a multi part upload and longer processing. Test once the render pipeline exists (weeks 5 to 6).
- **Token lifetime.** The token came from the portal's Token Generator; its time to live is shown on the Token Details page but was not recorded here. Note it before the demo.
- **Error shapes and rate limits.** Nothing failed, so error bodies for an expired token, a bad image or throttling are unseen.
