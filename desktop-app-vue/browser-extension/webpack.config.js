const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = (env) => {
  const browser = env.browser || 'chrome';

  return {
    mode: 'development',
    devtool: 'inline-source-map',
    entry: {
      'popup/popup': './src/popup/popup.js',
      'background/background': './src/background/background.js',
      'content/content-script': './src/content/content-script.js',
    },
    output: {
      path: path.resolve(__dirname, `build/${browser}`),
      filename: '[name].js',
    },
    plugins: [
      new CopyPlugin({
        patterns: [
          {
            from: `manifests/manifest-${browser}.json`,
            to: 'manifest.json',
            noErrorOnMissing: true,
          },
          {
            from: 'src/popup/*.html',
            to: 'popup/[name][ext]',
            noErrorOnMissing: true,
          },
          {
            from: 'src/popup/*.css',
            to: 'popup/[name][ext]',
            noErrorOnMissing: true,
          },
          {
            from: 'icons',
            to: 'icons',
            noErrorOnMissing: true,
          },
          {
            from: 'src/common/readability.js',
            to: 'lib/readability.js',
            noErrorOnMissing: true,
          },
        ],
      }),
    ],
    resolve: {
      extensions: ['.js', '.json'],
    },
  };
};
