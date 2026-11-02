#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)), assets=path.join(root,'assets'), captures=path.join(assets,'captures'), work=path.join(assets,'render'), out=path.join(root,'out');
mkdirSync(work,{recursive:true}); mkdirSync(out,{recursive:true});
const piper=process.env.PIPER_BIN||'piper', model=process.env.PIPER_MODEL;
if(!model) throw new Error('Set PIPER_MODEL to an offline Piper .onnx voice file');
const units=[
 ['intro-slide','s01-agent',8,'Nalvis brings Ledger-governed DeFi automation to HashKey Chain. Here is the live system and its proof.'],
 ['s01-agent','s01-agent',16,'This is Nishanth’s public mainnet agent. The feed shows when it last woke, its status, its latest decision, and the signals behind that decision.'],
 ['s02-market','s02-market',9,'Market evidence separates live observations from recorded charts. Missing values stay unavailable instead of becoming invented prices.'],
 ['s03-mandate','s03-mandate',10,'The signed mandate sets the agent, expiry, trade size, daily turnover and slippage limits. The owner retains pause and revoke.'],
 ['s04-operations','s04-operations',8,'The operations view maps evidence, strategy, checks, execution and receipts. Each stage shows what was actually observed.'],
 ['s05-activity','s05-activity',10,'Activity records decisions, including waits. Open a row to inspect its timestamp, rationale and transaction link.'],
 ['s06-copilot','s06-copilot',9,'Copilot can prepare a buy or sell review. A request alone does not send a trade.'],
 ['s07-swap-proof','s07-swap-proof',19,'Here is the mainnet swap. One USDT left the vault and 11.391399 WHSK returned through HSKSwap. Block 29644690 includes the vault Receipt event, sequence six.'],
 ['s08-verifier','s08-verifier',12,'The independent verifier rechecks the signature, mandate, calldata, transaction and chain head against the committed proof files. All eighteen checks pass.'],
 ['s09-architecture','s09-architecture',11,'The Ledger sets authority. The models propose. Deterministic checks and the vault constrain execution; OCI keeps the journal and live feed.'],
 ['outro-slide','s01-agent',8,'That is Nalvis: bounded execution with a mainnet swap anyone can inspect. Explore the live app and its proof.']];
const run=(c,a,o={})=>execFileSync(c,a,{stdio:'inherit',...o});
const wavDuration=f=>{const b=readFileSync(f);let p=12;while(p<b.length-8){const id=b.toString('ascii',p,p+4),n=b.readUInt32LE(p+4);if(id==='data')return n/(b.readUInt32LE(28));p+=8+n+(n%2)}throw new Error(`No WAV data chunk in ${f}`)};
const stamp=n=>`${Math.floor(n/3600)}:${String(Math.floor(n%3600/60)).padStart(2,'0')}:${(n%60).toFixed(2).padStart(5,'0')}`;
const wrap=(text,max=66)=>{const lines=[];let line='';for(const word of text.split(' ')){if((line+' '+word).trim().length>max){lines.push(line);line=word}else line=(line+' '+word).trim()}if(line)lines.push(line);return lines.join('\\N')};
let at=0;const timeline=[],concatV=[],concatA=[],events=[];
for(const [id,imageId,duration,text] of units){
 const raw=path.join(work,`${id}-raw.wav`),audio=path.join(work,`${id}.wav`),video=path.join(work,`${id}.mp4`),input=path.join(work,`${id}.txt`);
 writeFileSync(input,`${text}\n`); execFileSync(piper,['--model',model,'--input_file',input,'--output_file',raw],{stdio:'inherit'});
 const tempo=Math.max(1,wavDuration(raw)/(duration-.55)); if(tempo>1.45)throw new Error(`${id} speech rate ${tempo.toFixed(2)}`);
 run('ffmpeg',['-y','-loglevel','error','-i',raw,'-af',`${tempo>1.001?`atempo=${tempo.toFixed(8)},`:''}apad,atrim=duration=${duration}`,'-ar','48000','-ac','1',audio]);
 const vf=id==='intro-slide'?`scale=1920:1080,drawbox=x=0:y=0:w=iw:h=ih:color=black@0.58:t=fill,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='NALVIS':fontcolor=white:fontsize=104:x=(w-text_w)/2:y=360,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='Ledger-governed DeFi automation on HashKey Chain':fontcolor=0xb8ff3d:fontsize=38:x=(w-text_w)/2:y=500`
 :id==='outro-slide'?`scale=1920:1080,drawbox=x=0:y=0:w=iw:h=ih:color=black@0.66:t=fill,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='NALVIS':fontcolor=white:fontsize=96:x=(w-text_w)/2:y=250,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='Bounded execution. Verifiable receipts.':fontcolor=0xb8ff3d:fontsize=38:x=(w-text_w)/2:y=385,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf:text='nalvis-hsk-delta.vercel.app':fontcolor=white:fontsize=25:x=(w-text_w)/2:y=510,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf:text='github.com/n1shanthb/Nalvis-HSK':fontcolor=white:fontsize=25:x=(w-text_w)/2:y=555,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf:text='hsk.blockscout.com/tx/0x7a3020fb...d5722b':fontcolor=white:fontsize=25:x=(w-text_w)/2:y=600`
 :`scale=1920:1080,zoompan=z='min(zoom+0.00008,1.012)':d=${duration*30}:s=1920x1080:fps=30`;
 run('ffmpeg',['-y','-loglevel','error','-loop','1','-i',path.join(captures,`${imageId}.png`),'-vf',vf,'-t',String(duration),'-r','30','-an','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p',video]);
 concatV.push(`file '${video}'`);concatA.push(`file '${audio}'`);events.push(`Dialogue: 0,${stamp(at+.18)},${stamp(at+duration-.18)},Default,,0,0,0,,${wrap(text)}`);timeline.push({id,start:at,duration,midpoint:at+duration/2});at+=duration;
}
if(at!==120)throw new Error(`Timeline ${at}s`);
writeFileSync(path.join(work,'video.txt'),concatV.join('\n'));writeFileSync(path.join(work,'audio.txt'),concatA.join('\n'));writeFileSync(path.join(root,'timeline.json'),JSON.stringify(timeline,null,2));
writeFileSync(path.join(work,'captions.ass'),`[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Default,DejaVu Sans,34,&H00FFFFFF,&H000000FF,&H00101810,&HC0000000,-1,0,0,0,100,100,0,0,3,1,0,2,100,100,42,1\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n${events.join('\n')}\n`);
run('ffmpeg',['-y','-loglevel','error','-f','concat','-safe','0','-i',path.join(work,'video.txt'),'-c','copy',path.join(work,'video.mp4')]);run('ffmpeg',['-y','-loglevel','error','-f','concat','-safe','0','-i',path.join(work,'audio.txt'),'-c:a','pcm_s16le',path.join(work,'audio.wav')]);
run('ffmpeg',['-y','-loglevel','error','-i',path.join(work,'video.mp4'),'-i',path.join(work,'audio.wav'),'-vf',`ass=${path.join(work,'captions.ass')}`,'-c:v','libx264','-preset','medium','-crf','23','-maxrate','3M','-bufsize','6M','-c:a','aac','-b:a','128k','-movflags','+faststart','-t','120',path.join(out,'nalvis-2min.mp4')]);
console.log('Rendered 120-second master');
