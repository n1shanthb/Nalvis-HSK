import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(root, 'assets');
const sb = JSON.parse(readFileSync(path.join(assets, 'storyboard.json'), 'utf8'));
const units = [
  ['intro-slide', sb.intro, 8, true],
  ...sb.scenes.map((scene, index) => [scene.id, scene, [16, 9, 10, 8, 10, 9, 19, 12, 11][index], false]),
  ['outro-slide', sb.outro, 8, true],
];
const probe = (file) => Number(execFileSync('ffprobe', ['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1', file]).toString());
mkdirSync(path.join(assets, 'audio', 'timed'), {recursive: true});
let start = 0; const timeline = [];
for (const [id, obj, seconds, slide] of units) {
  const source = path.join(assets, 'audio', `${id}.mp3`);
  const sourceDuration = probe(source);
  const budget = seconds - (slide ? 1.45 : 0.7);
  const rate = Math.max(0.85, sourceDuration / budget);
  if (rate > 1.45) throw new Error(`${id}: narration needs excessive speed ${rate.toFixed(2)}`);
  const output = path.join(assets, 'audio', 'timed', `${id}.wav`);
  execFileSync('ffmpeg', ['-y','-loglevel','error','-i',source,'-af',`atempo=${rate.toFixed(8)},apad,atrim=duration=${budget}`,'-ar','48000','-ac','1',output]);
  obj.audio = `audio/timed/${id}.wav`; obj.audioDuration = budget; delete obj.words;
  timeline.push({id, start, duration: seconds, midpoint: start + seconds / 2, sourceAudioDuration: sourceDuration, speechRate: rate});
  start += seconds;
}
if (start !== 120) throw new Error(`Timeline is ${start}s, expected 120s`);
writeFileSync(path.join(assets, 'storyboard.json'), JSON.stringify(sb, null, 2));
writeFileSync(path.join(root, 'timeline.json'), JSON.stringify(timeline, null, 2));
console.log(JSON.stringify(timeline, null, 2));
console.log('Timeline: 3600 frames / 120 seconds');
