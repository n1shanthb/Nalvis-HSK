#!/usr/bin/env python3
"""Validate the render and create a three-frame PNG contact sheet per scene."""
import json, subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
root=Path(__file__).resolve().parent; video=root/'out'/'nalvis-2min.mp4'
meta=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',video]))
v=next(s for s in meta['streams'] if s['codec_type']=='video'); a=next(s for s in meta['streams'] if s['codec_type']=='audio'); duration=float(meta['format']['duration'])
assert (int(v['width']),int(v['height']))==(1920,1080) and 115<=duration<=125
assert v['codec_name']=='h264' and a['codec_name']=='aac'
subprocess.run(['ffmpeg','-v','error','-i',video,'-f','null','-'],check=True)
timeline=json.loads((root/'timeline.json').read_text()); sheets=root/'out'/'contact-sheets'; sheets.mkdir(parents=True,exist_ok=True)
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',20)
for scene in timeline:
 sheet=Image.new('RGB',(1440,300),'#050806'); draw=ImageDraw.Draw(sheet)
 for i,fraction in enumerate((.2,.5,.8)):
  t=scene['start']+scene['duration']*fraction; frame=sheets/f".{scene['id']}-{i}.png"
  subprocess.run(['ffmpeg','-y','-loglevel','error','-ss',str(t),'-i',video,'-frames:v','1',frame],check=True)
  with Image.open(frame) as im: im.thumbnail((470,264)); sheet.paste(im,(i*480+5,30))
  frame.unlink()
 draw.text((8,5),f"{scene['id']}  {scene['start']:.0f}s–{scene['start']+scene['duration']:.0f}s",font=font,fill='#b8ff3d'); sheet.save(sheets/f"{scene['id']}.png")
report={'duration':duration,'resolution':[1920,1080],'fps':v['r_frame_rate'],'videoCodec':v['codec_name'],'audioCodec':a['codec_name'],'bytes':video.stat().st_size,'decodeCheck':'passed','contactSheets':len(timeline),'framesPerScene':3}
(root/'out'/'verification.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
