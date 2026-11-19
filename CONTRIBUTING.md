# Contributing

This repository is the Mapilio web app: the homepage, the map, the street viewer, the daily game and the drone demo. It is in beta, so feedback on how things look and work is as useful as code.

## Opening an issue

1. **Search first.** If someone already reported it, add a reaction or a comment with new details instead of opening a new issue.
2. **One problem or idea per issue.** Two bugs in one issue usually means one of them gets forgotten.
3. **Use a template.** Pick *Bug report* or *Idea or feedback* and fill in every required field.
4. **English, please**, so everyone can follow. Short is fine.

### A good bug report

- **A link.** The map and the viewer keep your position in the address bar. Copy it, and we see exactly what you saw.
- **Steps.** What you clicked, in order.
- **Expected and actual.** What should have happened, and what happened instead.
- **Browser and device.** For example "Firefox 133 on Windows 11" or "Safari on iPhone 15".
- **A screenshot or a short screen recording** if it is about something you see.

### A good idea or feedback

- Start with the problem: what were you trying to do?
- Then the idea: what would help?
- Say who it is for: mappers, photo contributors, visitors or developers.
- If it is about mapping, say which editor you use (iD, JOSM, Rapid, StreetComplete, …).

### What not to put in issues

- **A face or licence plate that isn't blurred, or a photo you want removed.** Email info@mapilio.com with the photo link. A public issue would only point more people to it.
- **Security problems.** See [SECURITY.md](SECURITY.md).
- **Problems with your Mapilio account or uploads.** Use [mapilio.com/contact](https://mapilio.com/contact).
- **The mobile app.** It has its own repository: [mapilio/mobile-apps](https://github.com/mapilio/mobile-apps/issues).

## Labels

| Label | Meaning |
| --- | --- |
| `bug` | Something is broken |
| `enhancement` | An idea, a change or design feedback |
| `question` | Needs an answer, not a change |
| `good first issue` | Small and well defined, good for a first pull request |
| `help wanted` | We would welcome a pull request |

## Pull requests

1. For anything bigger than a small fix, open an issue first so we can agree on the approach.
2. Branch from `main` and keep the change focused on one thing.
3. Run `npm test` and `npm run build`; both must pass.
4. In the description, say what changed and how you tested it. Add a screenshot for visual changes.
5. Never commit API keys or tokens. Local settings go in `.env.local`, which is ignored.

See the [README](README.md#run-it-locally) to run the app locally.

By contributing you agree that your contribution is licensed under the MIT licence.
