// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// dùng transformer cho .svg
config.transformer.babelTransformerPath = require.resolve(
  "react-native-svg-transformer"
);

// bỏ "svg" khỏi assetExts, thêm vào sourceExts
config.resolver.assetExts = config.resolver.assetExts.filter(
  (ext) => ext !== "svg"
);
config.resolver.sourceExts = [...config.resolver.sourceExts, "svg"];

module.exports = config;
