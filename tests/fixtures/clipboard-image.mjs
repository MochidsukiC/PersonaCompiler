import { app, clipboard, ClipboardItem, nativeImage } from 'electron'
import { Blob, Buffer } from 'node:buffer'
import { error } from 'node:console'

app.whenReady().then(async () => {
  const png = nativeImage.createFromBitmap(Buffer.alloc(16, 255), { width: 2, height: 2 }).toPNG()
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })])
  if (!await clipboard.has('image/png')) throw new Error('Image clipboard fixture was not written')
  app.quit()
}).catch(reason => { error(reason); app.exit(1) })
