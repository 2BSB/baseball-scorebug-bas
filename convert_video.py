"""把浏览器导出的叠加视频在本地转换成常见容器（全程离线，不上传）。

用法：
    python convert_video.py 棒球计分-叠加视频.mp4 --to mov
    python convert_video.py 棒球计分-叠加视频.webm --to mp4
    python convert_video.py 输入.webm --to mkv --output 成片.mkv

--to 支持：mp4 / mov / mkv / webm / avi。需要本机安装 ffmpeg 并在 PATH 中。
未安装时会打印安装提示与等价的手工命令，不会偷偷下载任何东西。
"""
import argparse
import os
import shutil
import subprocess
import sys

PRESETS = {
    'mp4': ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'],
    'mov': ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'],
    'mkv': ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '160k'],
    'webm': ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-c:a', 'libopus', '-b:a', '128k'],
    'avi': ['-c:v', 'mpeg4', '-q:v', '4', '-c:a', 'libmp3lame', '-b:a', '192k'],
}
INSTALL_HINT = (
    '未找到 ffmpeg。请先安装：\n'
    '  Windows : winget install Gyan.FFmpeg  或  https://www.gyan.dev/ffmpeg/builds/\n'
    '  macOS   : brew install ffmpeg\n'
    '  Linux   : sudo apt install ffmpeg\n'
)


def main():
    ap = argparse.ArgumentParser(description='本地转换叠加视频容器（离线）')
    ap.add_argument('input', help='浏览器导出的视频文件')
    ap.add_argument('--to', required=True, choices=sorted(PRESETS), help='目标容器扩展名')
    ap.add_argument('--output', default='', help='输出文件名（默认与输入同名、换扩展名）')
    ap.add_argument('--force', action='store_true', help='目标文件已存在时覆盖')
    args = ap.parse_args()

    src = os.path.abspath(args.input)
    if not os.path.isfile(src):
        print('找不到输入文件：' + src)
        return 2
    out = os.path.abspath(args.output) if args.output else os.path.splitext(src)[0] + '.' + args.to
    if os.path.exists(out) and not args.force:
        print('输出文件已存在：' + out + '\n如要覆盖请加 --force，或用 --output 指定其它文件名。')
        return 2

    cmd = ['ffmpeg', '-hide_banner', '-y' if args.force else '-n', '-i', src] + PRESETS[args.to] + [out]
    exe = shutil.which('ffmpeg')
    if not exe:
        print(INSTALL_HINT)
        print('等价手工命令：')
        print('  ' + ' '.join('"' + c + '"' if ' ' in c else c for c in cmd))
        return 3

    print('输入：' + src)
    print('输出：' + out)
    print('容器：' + args.to + '（本机转换，不联网）')
    print('命令：' + ' '.join('"' + c + '"' if ' ' in c else c for c in cmd))
    try:
        rc = subprocess.call([exe] + cmd[1:])
    except OSError as e:
        print('ffmpeg 启动失败：' + str(e))
        return 4
    if rc != 0:
        print('ffmpeg 转换失败（退出码 %d）。若源文件是浏览器直出的 MP4，可先试 --to mkv，或换用 --to mp4 重封装。' % rc)
        return rc or 5
    print('完成：%s（%.1f MB）' % (out, os.path.getsize(out) / 1048576.0))
    return 0


if __name__ == '__main__':
    sys.exit(main())
