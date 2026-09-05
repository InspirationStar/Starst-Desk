"""
Starst Desk 应用图标生成脚本
生成 256x256 PNG 图标和多尺寸 ICO 文件
"""
from PIL import Image, ImageDraw, ImageFilter
import math
import os

def create_gradient_background(size):
    """创建蓝紫渐变背景"""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    pixels = img.load()
    for y in range(size):
        for x in range(size):
            # 对角线渐变：从 #409eff（蓝）到 #6366f1（靛蓝）
            t = (x + y) / (2 * size)
            r = int(64 + (99 - 64) * t)
            g = int(158 + (102 - 158) * t)
            b = int(255 + (241 - 255) * t)
            pixels[x, y] = (r, g, b, 255)
    return img

def apply_rounded_corners(img, radius):
    """应用圆角"""
    size = img.size[0]
    mask = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    result = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    result.paste(img, (0, 0), mask)
    return result

def draw_star(draw, cx, cy, outer_r, inner_r, color):
    """绘制五角星"""
    points = []
    for i in range(10):
        angle = math.pi / 2 + i * math.pi / 5
        r = outer_r if i % 2 == 0 else inner_r
        x = cx + r * math.cos(angle)
        y = cy - r * math.sin(angle)
        points.append((x, y))
    draw.polygon(points, fill=color)

def draw_desk_line(draw, cx, cy, width, color):
    """在星星下方画一条桌面线条（装饰）"""
    draw.rounded_rectangle(
        [cx - width // 2, cy + 5, cx + width // 2, cy + 10],
        radius=2, fill=color
    )

def generate_icon(size):
    """生成指定尺寸的图标"""
    # 1. 渐变背景
    img = create_gradient_background(size)

    # 2. 圆角
    radius = max(4, size // 6)
    img = apply_rounded_corners(img, radius)

    # 3. 绘制装饰
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2 - size // 10

    # 星星
    outer_r = int(size * 0.28)
    inner_r = int(size * 0.12)
    # 白色星星，带轻微阴影
    draw_star(draw, cx + 1, cy + 2, outer_r, inner_r, (0, 0, 0, 40))  # 阴影
    draw_star(draw, cx, cy, outer_r, inner_r, (255, 255, 255, 255))   # 主体

    # 桌面装饰线
    line_width = int(size * 0.3)
    draw_desk_line(draw, cx, cy + int(size * 0.22), line_width, (255, 255, 255, 180))

    return img

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    resources_dir = os.path.join(project_root, 'resources')

    # 生成 256x256 主图标
    print('生成 256x256 PNG 图标...')
    icon_256 = generate_icon(256)
    icon_256_path = os.path.join(resources_dir, 'icon.png')
    icon_256.save(icon_256_path, 'PNG')
    print(f'  已保存: {icon_256_path}')

    # 生成 ICO（包含多种尺寸，以 256x256 为源自动缩放）
    print('生成多尺寸 ICO 文件...')
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    ico_path = os.path.join(resources_dir, 'icon.ico')
    icon_256.save(ico_path, format='ICO', sizes=ico_sizes)
    print(f'  已保存: {ico_path}')

    # 生成托盘图标（32x32 简化版）
    print('生成托盘图标...')
    tray_icon = generate_icon(32)
    tray_path = os.path.join(resources_dir, 'tray-icon.png')
    tray_icon.save(tray_path, 'PNG')
    print(f'  已保存: {tray_path}')

    # 托盘提醒图标（带橙色色调）
    print('生成托盘提醒图标...')
    alert_icon = generate_icon(32)
    # 叠加橙色提醒色
    overlay = Image.new('RGBA', (32, 32), (230, 162, 60, 80))
    alert_icon = Image.alpha_composite(alert_icon, overlay)
    alert_path = os.path.join(resources_dir, 'tray-icon-alert.png')
    alert_icon.save(alert_path, 'PNG')
    print(f'  已保存: {alert_path}')

    print('\n图标生成完成！')

if __name__ == '__main__':
    main()