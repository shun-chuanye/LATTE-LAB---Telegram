# LATTE LAB Telegram Order

Static Telegram Mini App for coffee ordering. The menu is maintained in `menu and price.xlsx`, product photos live in `image/`, and orders can be inserted into Supabase from the browser with the public anon/publishable key.

## Files

- `index.html` - static entry point for GitHub Pages and BotFather.
- `app.js` - Telegram Web App, Excel menu parsing, cart, checkout, Supabase insert.
- `styles.css` - responsive mobile-first UI.
- `config.js` - public runtime configuration.
- `menu and price.xlsx` - source of menu categories, names, Khmer labels, prices, and promotions.
- `image/` - product images and logo.
- `supabase/schema.sql` - database table, grants, and RLS policy for order inserts.

## Local Preview

Run a local static server from this folder:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`.

## Supabase Setup

This folder is already configured for the Supabase project `LATTE  LAB`
(`haoxzanlyccedoikbqdd`) with a public publishable key.

If you switch to another Supabase project:

1. Create or open the Supabase project.
2. Run `supabase/schema.sql` in the SQL Editor.
3. In Project Settings, copy the Project URL and the public anon/publishable key.
4. Paste them into `config.js`:

```js
window.LATTE_LAB_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
  supabaseAnonKey: "YOUR_PUBLIC_KEY",
};
```

Do not put a `service_role`, secret, or bot token in frontend code.

The default policy allows anonymous users to insert new orders only. It does not allow public order reads, updates, or deletes.

## GitHub Pages

1. Create a GitHub repository.
2. Push this folder to the repository.
3. In GitHub, open Settings > Pages.
4. Deploy from the `main` branch, root folder.
5. Use the generated HTTPS URL as the Telegram Web App URL.

## BotFather

In Telegram, open `@BotFather` and use `/setmenubutton` or Bot Settings > Menu Button. Set the button text, for example `Order Coffee`, and paste the GitHub Pages HTTPS URL.

Telegram official docs:

- https://core.telegram.org/bots/webapps
- https://core.telegram.org/bots/api#setchatmenubutton
