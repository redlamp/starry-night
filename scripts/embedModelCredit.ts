// One-shot: embed the CC attribution into the GLB's asset.copyright field
// so the credit travels with the file. Usage: bunx tsx scripts/embedModelCredit.ts

import { NodeIO } from "@gltf-transform/core";

const FILE = "public/models/mac-128k-daz.glb";
const CREDIT =
  '"Macintosh 128K Computer (1984)" (https://skfb.ly/6SLnE) by Daz is licensed under Creative Commons Attribution-NonCommercial (http://creativecommons.org/licenses/by-nc/4.0/).';

const io = new NodeIO();
const doc = await io.read(FILE);
doc.getRoot().getAsset().copyright = CREDIT;
await io.write(FILE, doc);
console.log(`embedded copyright into ${FILE}`);
