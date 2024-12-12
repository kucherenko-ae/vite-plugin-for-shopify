Vite plugin for generate snippet with all inputs (entries).

## Usage

### Add the plugin to your `vite.config.js`

All options are not required:

```js
import shopifyVitePlugin from '@alexander.k/vite-plugin-for-shopify'

export default {
  plugins: [
    shopifyVitePlugin({
      // root path to theme, default value is './'
      themeRoot: './',
      // snippet you will use in the liquid, default value is 'vite.liquid'
      snippetFilename: 'vite.liquid',
      cleanup: {
        // regex for filtering files in the assets folder that are generated during assembly,
        // needed to remove files from previous assemblies,
        // for example if files are created with a hash in the name
        // there is no default value, old files will not be deleted
        fileNameRegex: /.*\.min\.(js|css)$/m
      }
    })
  ]
}
```

### Add snippet to <head></head> without params once

it will add the helper function for dynamic import in your code

```liquid
{% render 'vite' %}
```

### Use snippet with entryName as in inputs, for example:

inputs in the vite.config.js

```js
export default defineConfig({
  plugins: [
    shopifyVitePlugin(),
    ...
  ],
  build: {
    rollupOptions: {
      input: {
        theme: './some-path/theme.js',
        coolSection: './some-path/collSection.js',
        utils: './some-path/utils.js',
        pageStyles: './some-path/pageStyles.css'
        ...
      },
      ...
    },
    ...
  },
  ...
})
```

#### default

```liquid
{% liquid
  # it can also preload styles
  render 'vite', entry: 'theme', preload_stylesheet: true
  render 'vite', entry: 'pageStyles'
  render 'vite', entry: 'coolSection'
%}
```

#### only styles or only js

```liquid
{% liquid
  # only style
  render 'vite', entry: 'theme', only_css: true
  # only js
  render 'vite', entry: 'coolSection', only_js: true
%}
```

#### import mode for styles

```liquid
<template class="component-template">
  <style>
    {% render 'vite', entry: 'theme', only_css: true, import_mode: true %}
    :root {
      display: block;
    }
    .wrapper {
      padding: 10px;
    }
  </style>
  <div class="wrapper">
    <button class="global-class-from-theme">Button</button>
  </div>
</template>
```

==> result:

```html
<template class="component-template">
  <style>
    @import url("//www.your-store.com/cdn/shop/t/111/assets/theme.C0CJB5x1.min.css");
    :root {
      display: block;
    }
    .wrapper {
      padding: 10px;
    }
  </style>
  <div class="wrapper">
    <button class="global-class-from-theme">Button</button>
  </div>
</template>
```

#### import mode for js

```liquid
<script type="module">
  {% render 'vite', entry: 'utils', only_js: true, import_mode: true, import_name: '{ getCart }' %}

  const cart = getCart()
</script>
```

==> result:

```html
<script type="module">
  import { getCart } from "//www.your-store.com/cdn/shop/t/111/assets/utils.C0CJB5x1.min.js";

  const cart = getCart()
</script>
```

or dynamic way

```liquid
<script type="module">
  const addClickHandler = async (items) => {
    {% render 'vite', entry: 'utils', only_js: true, import_mode: true, dynamic_import: true, import_name: '{ addToCart }' %}

    return await addToCart(items)
  }
</script>
```

==> result:

```html
<script type="module">
  const addClickHandler = async (items) => {
    const { addToCart } = await import("//www.your-store.com/cdn/shop/t/111/assets/utils.C0CJB5x1.min.js");

    return await addToCart(items)
  }
</script>
```