# Brand artwork

The app serves these logos locally, so loading a page does not request third-party assets. Artwork is displayed in its original colors on white surfaces and identifies the corresponding integration; Scout is a separate application.

| Asset | Official source | Preparation |
| --- | --- | --- |
| `public/brands/vinted.svg` | [Vinted company site](https://company.vinted.com/media) | Extracted the header SVG, preserving its path and the site's `#007782` color. Removed the site-specific CSS class. |
| `public/brands/ebay.svg` | [eBay global header](https://gh.ebaystatic.com/) | Extracted the eBay SVG, preserving paths, colors and viewBox; quoted HTML attributes for standalone SVG and removed document-specific IDs. |
| `public/brands/telegram.svg` | [Telegram logo downloads](https://telegram.org/tour/screenshots) | Original `Logo.svg` from the linked official ZIP. |
| `public/favicon.svg` | Existing Scout radar mark, from the installed [Lucide Radar icon](https://lucide.dev/icons/radar) | Same Radar paths in Scout's charcoal/peach tile. Shared by the app logo and favicon. Lucide is ISC licensed. |

Retrieved 2026-10-30. These brand marks remain the property of their owners. Download availability is not a general license: Vinted's media page specifies press-illustration use; Telegram's page permits illustrative/button use provided it does not suggest official representation. Review the respective brand terms for public commercial distribution.
