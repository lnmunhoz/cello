// electron-builder's afterPack hook (electron-builder.json): runs once Cello.app is assembled, before it's
// signed and before the DMG and zip are made from it. electron-builder copies the whole local Electron
// (electronDist), Electron's demo app included, and only removes that from an Electron it downloads itself.
// The app never falls back to it, so it goes here, where every target (dir, DMG, zip) and the signature see it gone.
const fs = require("node:fs")
const path = require("node:path")

exports.default = async (context) => {
  if (context.electronPlatformName !== "darwin") return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  fs.rmSync(path.join(app, "Contents/Resources/default_app.asar"), { force: true })
}
