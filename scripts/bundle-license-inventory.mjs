/** Preserve dependency license files for packages actually included in esbuild output. */
import {cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";

/** Copy exact package notices and record package versions with the bundled input paths. */
export function collectBundleLicenses(root, output, metafiles) {
  const packages = new Map();
  for (const metafile of metafiles) {
    for (const input of Object.keys(metafile.inputs)) {
      const absolute = path.resolve(root, input);
      const parts = absolute.split(path.sep);
      const index = parts.lastIndexOf("node_modules");
      if (index < 0) continue;
      const count = parts[index + 1].startsWith("@") ? 3 : 2;
      const packageRoot = parts.slice(0, index + count).join(path.sep);
      const manifest = JSON.parse(readFileSync(path.join(packageRoot,"package.json"),"utf8"));
      const packagePath = path.relative(root, packageRoot).replaceAll(path.sep,"/");
      const key = `${manifest.name}@${manifest.version}-${createHash("sha256").update(packagePath).digest("hex")}`;
      const previous = packages.get(key);
      if (previous && previous.root !== packageRoot) throw new Error(`Ambiguous bundled dependency ${key}`);
      if (!previous) packages.set(key,{root:packageRoot,packagePath,manifest,inputs:new Set()});
      packages.get(key).inputs.add(path.relative(packageRoot, absolute).replaceAll(path.sep,"/"));
    }
  }
  const inventory=[];
  for (const [key, entry] of [...packages].sort(([a],[b])=>a.localeCompare(b))) {
    const notices = readdirSync(entry.root,{withFileTypes:true}).filter(item=>item.isFile() && /^(licen[cs]e|copying|notice)([.-]|$)/i.test(item.name));
    if (!notices.length) throw new Error(`Bundled dependency has no redistributable license file: ${key}`);
    const folder = path.join(output,"licenses","javascript",createHash("sha256").update(key).digest("hex").slice(0,24));
    if (existsSync(folder)) throw new Error("Dependency license path collision");
    mkdirSync(folder,{recursive:true});
    const files=[];
    for (const notice of notices) {
      const source=path.join(entry.root,notice.name);
      cpSync(source,path.join(folder,notice.name));
      files.push({path:path.relative(output,path.join(folder,notice.name)).replaceAll(path.sep,"/"),sha256:createHash("sha256").update(readFileSync(source)).digest("hex")});
    }
    inventory.push({packagePath:entry.packagePath,name:entry.manifest.name,version:entry.manifest.version,license:entry.manifest.license ?? null,files,inputs:[...entry.inputs].sort()});
  }
  if (!inventory.length) throw new Error("Empty bundled JavaScript dependency inventory");
  writeFileSync(path.join(output,"licenses/javascript-inventory.json"),JSON.stringify({schemaVersion:1,packages:inventory},null,2)+"\n");
  return inventory;
}
