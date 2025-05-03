
'use strict';

const path = require('path');

/** @type {import('webpack').Configuration} */
const proxyConfig = {
  target: 'node',
  mode: 'none',
  entry: './src/proxy/proxy.ts',
  output: {
    path: path.resolve(__dirname, '../../dist'),
    filename: 'proxy.js',
    libraryTarget: 'commonjs2'
  },
  externals: {
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: "log",
  },
};

module.exports = [ proxyConfig ];
