import { resolve } from 'node:path'
import { readdir, readFile, writeFile, unlink, access, constants } from 'fs/promises'

const PLUGIN_NAME = 'vite-plugin-for-shopify'
const DEFAULT_OUT_DIR = './assets'
const DYNAMIC_IMPORT_HELPER_FUNCTION_NAME = '_viteAssetPath'

/**
 * A vite plugin for Shopify theme development.
 *
 * The plugin creates a snippet (`vite.liquid` by default) in `themeRoot/snippets` directory
 * which can be used to include all the entries build by vite in the theme.
 *
 * The plugin also removes all the files in `build.outDir` which are not present in the new build.
 *
 * which can be used to access the global assets path.
 *
 * @param {Object} options - The plugin options.
 * @param {string} [options.themeRoot='./'] - The root of the theme.
 * @param {string} [options.snippetFilename='vite.liquid'] - The name of the snippet file.
 * @param {Object} [options.cleanup]
 * @param {RegExp} [options.cleanup.fileNameRegex] - A regex to filter out files in `build.outDir` which created by vite.
 * @returns {Object} The Vite plugin configuration.
 */
const shopifyVitePlugin = (options = {}) => {
  const _options = {
    ...options,
    themeRoot: options.themeRoot ?? './',
    snippetFilename: options.snippetFilename ?? 'vite.liquid',
    cleanup: {
      ...options.cleanup,
      ...options.fileNameRegex !== undefined && options.cleanup?.fileNameRegex === undefined && { fileNameRegex: options.fileNameRegex } // support for previous options format
    }
  }

  const plugins = [
    config(_options),
    snippet(_options)
  ]

  _options.cleanup.fileNameRegex !== undefined && plugins.push(cleanup(_options))

  return plugins
}

const config = (options) => {
  return {
    name: `${PLUGIN_NAME}:config`,
    config (config) {
      return {
        ...config,
        build: {
          ...config.build,
          // add manifest to build
          manifest: typeof config.build?.manifest === 'string'
            ? config.build.manifest
            : '_manifest.json'
        },
        experimental: {
          ...config.experimental,
          renderBuiltUrl (filename, { hostType }) {
            if (hostType === 'js') {
              return {
                runtime: `${DYNAMIC_IMPORT_HELPER_FUNCTION_NAME}(${JSON.stringify(filename)})`
              }
            }

            return { relative: true }
          }
        }
      }
    }
  }
}

const cleanup = (options) => {
  let outDir = DEFAULT_OUT_DIR

  return {
    name: `${PLUGIN_NAME}:cleanup`,
    enforce: 'post',

    configResolved (config) {
      outDir = config.build?.outDir ?? outDir
    },

    async writeBundle (opt, bundle) {
      const fileNames = Object.keys(bundle)
      const files = await readdir(outDir)
      let consoleReport = ''

      await Promise.all(files.map(async file => {
        if (options.cleanup.fileNameRegex.test(file) && !fileNames.includes(file)) {
          consoleReport += `${file}\n`
          return await unlink(resolve(outDir, file))
        }
        return null
      }))

      consoleReport.length > 0 &&
      console.log(`\x1b[36m\n\ndirectory "${outDir}" was cleaned, removed files:\x1b[33m\n${consoleReport}\x1b[0m`)
    }
  }
}

const snippet = (options = {}) => {
  let resolvedConfig
  let themeRoot = options.themeRoot ?? './'
  let snippetFilename = options.snippetFilename ?? 'vite.liquid'
  let manifestFilename = '_manifest.json'
  let input = {}
  let outDir = DEFAULT_OUT_DIR

  return {
    name: `${PLUGIN_NAME}:snippet`,
    enforce: 'post',

    configResolved (config) {
      resolvedConfig = config
      input = config.build?.rollupOptions?.input ?? input
      outDir = config.build?.outDir ?? outDir
      manifestFilename = config.build.manifest
    },

    // Create snippet from manifest
    async closeBundle () {
      const manifestPath = resolve(outDir, manifestFilename)

      if (!(await checkFileExists(manifestPath))) {
        return
      }

      const entryNameByPath = {}
      Object.keys(input).forEach((key) => {
        let path = input[key]
        // notmalize path
        if (path.startsWith('./')) {
          path = path.substring(2)
        }
        entryNameByPath[path] = key
      })

      try {
        const manifestFile = await readFile(manifestPath)
        const manifest = JSON.parse(manifestFile)
        const manifestValues = Object.values(manifest)
        const allEntries = []

        manifestValues.forEach(({ isEntry, css = [], imports = [], name, src, file }) => {
          // add entry to snippet
          if (isEntry === true) {
            const styleFiles = new Set()
            const jsFiles = new Set()
            const assets = []
            const entryName =
              name ??
              entryNameByPath[src] ??
              src.substring(src.lastIndexOf('/') + 1, src.lastIndexOf('.'))

            const handleEntryImports = ({ src, file, css = [], imports = [] }) => {
              if (isStyles(src)) {
                // check if entry is css
                styleFiles.add(file)
              } else {
                // in another case it's js
                css.length > 0 && css.forEach(cssFile => {
                  styleFiles.add(cssFile)
                })
                imports.forEach(imp => {
                  handleEntryImports(manifest[imp])
                })
              }
            }

            handleEntryImports({ src, file, css, imports })
            !isStyles(src) && jsFiles.add(file)

            styleFiles.size > 0 && assets.push(assignStyleFiles([...styleFiles]))
            jsFiles.size > 0 && assets.push(assignScriptFiles([...jsFiles]))

            allEntries.push(entryTag(entryName, assets.join('')))
          }
        })

        // Update vite.liquid file in snippets
        await writeFile(
          resolve(themeRoot, `./snippets/${snippetFilename}`),
          `{%- liquid${snippetStart}\n  case entry${allEntries.join('')}\n  endcase\n${snippetEnd}\n-%}`
        )

        // Remove manifest
        resolvedConfig.mode !== 'development' && (await unlink(manifestPath))

      } catch (err) {
        console.error(err)
      }
    }
  }
}

/**
 * Checks if a file exists at the given path.
 *
 * @param {string} path - The file path to check.
 * @returns {Promise<boolean>} - A promise that resolves to true if the file exists, otherwise false.
 */
const checkFileExists = async (path) => {
  try {
    await access(path, constants.F_OK)
    return true
  } catch (err) {
    return false
  }
}

const styleRegex = /\.(sa|sc|c)ss$/
const isStyles = (src) => styleRegex.test(src)

const assignScriptFiles = fileNames => `
      assign js_files = "${fileNames.join('|')}"`
const assignStyleFiles = fileNames => `
      assign style_files = "${fileNames.join('|')}"`

const entryTag = (entryName, assets) => `
    when '${entryName}'${assets}`

const snippetStart = `
  # ------------------------------------------------------------
  #
  # IMPORTANT:
  #
  # Do not edit this file directly.
  # This file is generated automatically by vite plugin.
  # 
  # ------------------------------------------------------------
  #
  # IMPORTANT:
  #
  # If you use dynamic imports, then you need to add this snippet
  # once to your theme without any parameters
  # it will add helper function for correct urls of dynamic imports
  # {{ render 'vite' }}
  #
  # ------------------------------------------------------------
  #
  # PARAMETERS:
  #
  # @param {string} entry - entry name, as in the vite.config.js
  # @param {boolean} preload_stylesheet - add preload for stylesheets
  # @param {boolean} only_css - add only css files
  # @param {boolean} only_js - add only js files
  #
  # ------------------------------------------------------------
  #
  # EXTRA PARAMETERS:
  #
  # @param {boolean} import_mode - for cases when you need to import
  # styles to styles - @import url("...");
  # modules to scripts - import {{ import_name }} from '...';
  # @param {boolean} import_name - import name for js modules
  # for example "{ funcName }"
  # @param {boolean} dynamic_import - for case when you need to import
  # js module asynchronously
  #
  # ------------------------------------------------------------
  #
  # USAGE EXAMPLES:
  #
  # - default
  # {{ render 'vite', entry: 'entryName' }}
  # - default and preload styles
  # {{ render 'vite', entry: 'entryName', preload_stylesheet: true }}
  # - only styles
  # {{ render 'vite', entry: 'entryName', only_css: true }}
  # - only scripts
  # {{ render 'vite', entry: 'entryName', only_js: true }}
  # - import styles
  # {{ render 'vite', entry: 'entryName', import_mode: true, only_css: true }}
  # - import js module
  # {{ render 'vite', entry: 'entryName', import_mode: true, only_js: true, import_name: '{ funcName }' }}
  # - import js module asynchronously
  # {{ render 'vite', entry: 'entryName', import_mode: true, only_js: true, dynamic_import: true, import_name: '{ funcName }' }}
  #
  # ------------------------------------------------------------

  assign style_files = ''
  assign js_files = ''
  assign css = true
  assign js = true

  if entry == blank
    echo '<script>(() => {'
    echo 'const path = '
    echo 'vite.js' | asset_url | split: 'vite' | first | split: '.com' | last | json
    echo ';window.${DYNAMIC_IMPORT_HELPER_FUNCTION_NAME} = (filename) => path + filename;'
    echo '})()</script>'
  endif

  if only_js
    assign css = false
  elsif only_css
    assign js = false
  endif

  if import_mode
    if only_css
      assign js = false
    else
      assign css = false
    endif
  endif
`

const snippetEnd = `
  assign style_files_arr = style_files | split: '|'
  assign js_files_arr = js_files | split: '|'

  if css
    for style_file in style_files_arr
      if import_mode
        echo '@import url("'
        echo style_file | asset_url | split: '?' | first 
        echo '");'
      else
        echo style_file | asset_url | split: '?' | first | stylesheet_tag: preload: preload_stylesheet
      endif
    endfor
  endif

  if js
    for js_file in js_files_arr
      if import_mode and import_name != blank
        if dynamic_import
          echo 'const '
          echo import_name
          echo ' = '
          echo 'await import("'
          echo js_file | asset_url | split: '?' | first
          echo '");'
        else
          echo 'import '
          echo import_name
          echo ' from "'
          echo js_file | asset_url | split: '?' | first
          echo '";'
        endif
      else
        echo '<script src="'
        echo js_file | asset_url | split: '?' | first 
        echo '" type="module" crossorigin="anonymous"></script>'
      endif
    endfor
  endif
`

export default shopifyVitePlugin
