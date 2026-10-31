# Move the Needle: how we work

The site is being built page by page. The user spins a page, we iterate on it in chat until it's right, and the user locks it on the site. See README "Editing pages" for the mechanics.

## Before touching anything
- `git pull --rebase` first: the site commits page edits straight to `docs/data/pages.json` on `main`.
- The user names a page by its URL hash (`#p-ruthba01` is the key `p_ruthba01`; `t_`, `g_`, `f_`, `y_`, `d_`, `L_` (leagues), `c_` for the other types).
- Read that page's entry in `docs/data/pages.json`, if it has one.

## Locked pages
- Never change a locked page's content (its entry in `pages.json`) unless the user asks for that page by name.
- Page layouts are shared by type: one player-page template draws every player. Before a code change that alters how a page type looks, check `pages.json` for locked pages of that type. Name the ones affected and ask first.
- Data and fetch-script changes can't alter an edited page's timeline (its own `items` win), but they do change the parts still drawn live: hero, career table, rankings, the scouting card's numbers.

## Page content
- An edited player page's `items` are the source of truth. When asked to change one page's writing or order, edit its items in `pages.json`. Don't change the generators unless the fix should apply to every page.
- To change what every draft starts with, change `seedItems` in `docs/app.js` or the source data.
- Editing chrome (forms, move buttons, research links) shows only with a GitHub token and never on locked pages. Visitors see every page clean.
