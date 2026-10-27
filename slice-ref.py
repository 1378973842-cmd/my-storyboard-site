import sys
from PIL import Image
src, outdir = sys.argv[1], sys.argv[2]
img = Image.open(src)
w, h = img.size
print("size", w, h)
n = 8
step = h // n
for i in range(n):
    top = i * step
    bottom = h if i == n - 1 else (i + 1) * step
    img.crop((0, top, w, bottom)).save(f"{outdir}/ref-slice-{i}.png")
    print(i, top, bottom)
