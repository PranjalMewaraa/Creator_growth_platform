# Spike: Instagram publishing in developer mode

**Question (plan section 11, week 1):** can we publish to a team controlled Instagram account through the Instagram API with Instagram Login, in developer mode, without app review?

**Answer: yes.** Run on 2026-09-18 with `spikes/instagram-publish.ts --publish`. Test post: https://www.instagram.com/p/Dda8uWAFOG_/ (safe to delete).

## What was run

| Step                | Call                                                   | Result                                           |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------ |
| Identify account    | `GET graph.instagram.com/me`                           | `@pranjalmewaraaa`, account type `MEDIA_CREATOR` |
| Quota               | `GET /{ig-user-id}/content_publishing_limit`           | 100 API posts per 24 hours, 0 used               |
| Create container    | `POST /{ig-user-id}/media` with `image_url`, `caption` | Created in 4.4 to 4.6s                           |
| Wait for processing | `GET /{container-id}?fields=status_code`               | `FINISHED` about 7.5s after creation             |
| Publish             | `POST /{ig-user-id}/media_publish` with `creation_id`  | Published in 3.6s                                |
| Confirm             | `GET /{media-id}?fields=permalink`                     | Permalink returned                               |

End to end for one image post: about 11 seconds. Calls were unversioned, so they used the app's default Graph API version.

## What this means for the build

- **Creator accounts work.** `MEDIA_CREATOR` published without a Facebook Page, which confirms the Instagram Login route in D2.
- **The irreversible step is exactly one call.** Creating a container is private and safe to retry; only `media_publish` makes the post public. That matches the claim before call design: set `post_targets.publish_started_at` immediately before `media_publish`, and store the container id in `prepared_ref` (A8, invariant 9).
- **Media must be a public JPEG URL.** Instagram fetches the image itself. The spike resolved redirects first and passed the final URL. For WP29 that means a signed R2 URL that Instagram can reach, valid for longer than container processing takes.
- **Quota is per account, 100 per 24 hours.** More than enough for the demo. Exhaustion maps to the `quota` failure category: requeue into the next window without using up an attempt.

## Not yet verified

- **Reels (video).** They need `media_type=REELS` with a `video_url` and take much longer to process. Test once the render pipeline produces a real video (weeks 5 to 6).
- **Token lifetime.** The token came from the dashboard's Generate access tokens step. Its expiry has not been checked; record it before the demo (plan section 3 says tokens are issued once and their expiry is noted by hand).
- **Error shapes.** Nothing failed, so the error bodies for a bad image, an expired token or an exhausted quota are unseen. The adapter's error mapping needs them.
- **Carousels.** Not needed for the demo runbook.
