<!--
  桌宠机器人角色组件
  职责：内联 SVG 绘制一个参考瓦力（WALL-E）风格的迷你机器人，根据状态切换 CSS 动画
  Props:
    - state: 当前状态（idle / reminding / happy / sleeping）
  设计参考：瓦力（WALL-E）——《机器人总动员》中的地球废品分装员机器人
    - 方形圆角机身，黄褐色锈迹质感（瓦力标志性配色）
    - 履带式底盘 + 两侧轮子（瓦力的移动方式）
    - 双筒望远镜眼睛，LED 蓝光透镜（瓦力最显著的大眼睛）
    - 折叠式分节手臂，从机身两侧伸出
    - 头顶太阳能板 + 红色信号天线灯
    - 颈部可伸缩关节
    - viewBox 0 0 140 140
-->
<template>
  <div class="pet-robot" :class="`pet-robot--${state}`">
    <svg class="pet-robot__svg" viewBox="0 0 140 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <!-- ====================================================== -->
      <!-- 渐变定义：机身黄褐渐变 / 履带金属渐变 / 太阳能板渐变     -->
      <!-- ====================================================== -->
      <defs>
        <!-- 机身：黄褐锈迹渐变（顶部受光、底部暗） -->
        <linearGradient id="walleBodyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#E0B85C" />
          <stop offset="50%" stop-color="#D4A24E" />
          <stop offset="100%" stop-color="#A07820" />
        </linearGradient>
        <!-- 胸前面板：深黄褐凹陷感 -->
        <linearGradient id="wallePanelGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#B8860B" />
          <stop offset="100%" stop-color="#8B6914" />
        </linearGradient>
        <!-- 履带金属渐变 -->
        <linearGradient id="walleTreadGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#4A4A4A" />
          <stop offset="100%" stop-color="#2A2A2A" />
        </linearGradient>
        <!-- 太阳能板渐变 -->
        <linearGradient id="walleSolarGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#2A4F7A" />
          <stop offset="50%" stop-color="#3A6FA5" />
          <stop offset="100%" stop-color="#2A4F7A" />
        </linearGradient>
      </defs>

      <!-- ====================================================== -->
      <!-- 地面阴影（底部）：营造存在感                            -->
      <!-- ====================================================== -->
      <ellipse class="pet-robot__shadow" cx="70" cy="132" rx="34" ry="5" fill="#1A1A1A" opacity="0.12" />

      <!-- ====================================================== -->
      <!-- 履带底盘（瓦力的移动方式：两侧轮子 + 履带）              -->
      <!-- ====================================================== -->
      <!-- 底盘连接座 -->
      <rect x="32" y="104" width="76" height="8" rx="3" fill="url(#walleTreadGrad)" />
      <!-- 履带带（轮子之间） -->
      <rect x="34" y="110" width="72" height="12" rx="2" fill="url(#walleTreadGrad)" />
      <!-- 左轮 -->
      <circle class="pet-robot__wheel pet-robot__wheel--left" cx="38" cy="118" r="10" fill="#2A2A2A" stroke="#1A1A1A" stroke-width="1.5" />
      <circle cx="38" cy="118" r="5" fill="#4A4A4A" />
      <circle cx="38" cy="118" r="1.5" fill="#1A1A1A" />
      <!-- 右轮 -->
      <circle class="pet-robot__wheel pet-robot__wheel--right" cx="102" cy="118" r="10" fill="#2A2A2A" stroke="#1A1A1A" stroke-width="1.5" />
      <circle cx="102" cy="118" r="5" fill="#4A4A4A" />
      <circle cx="102" cy="118" r="1.5" fill="#1A1A1A" />

      <!-- ====================================================== -->
      <!-- 手臂（折叠式分节，从机身两侧伸出）                       -->
      <!-- ====================================================== -->
      <!-- 左臂 -->
      <g class="pet-robot__arm pet-robot__arm--left">
        <circle cx="26" cy="58" r="4" fill="#9A9A9A" />
        <rect x="14" y="55" width="13" height="6" rx="3" fill="#9A9A9A" stroke="#6A6A6A" stroke-width="0.8" transform="rotate(-12 20 58)" />
        <circle cx="15" cy="64" r="3" fill="#6A6A6A" />
        <rect x="9" y="63" width="11" height="5" rx="2" fill="#7A7A7A" />
        <circle cx="11" cy="70" r="3.5" fill="#4A4A4A" stroke="#2A2A2A" stroke-width="0.8" />
      </g>
      <!-- 右臂 -->
      <g class="pet-robot__arm pet-robot__arm--right">
        <circle cx="114" cy="58" r="4" fill="#9A9A9A" />
        <rect x="113" y="55" width="13" height="6" rx="3" fill="#9A9A9A" stroke="#6A6A6A" stroke-width="0.8" transform="rotate(12 120 58)" />
        <circle cx="125" cy="64" r="3" fill="#6A6A6A" />
        <rect x="120" y="63" width="11" height="5" rx="2" fill="#7A7A7A" />
        <circle cx="129" cy="70" r="3.5" fill="#4A4A4A" stroke="#2A2A2A" stroke-width="0.8" />
      </g>

      <!-- ====================================================== -->
      <!-- 机身（方形圆角，黄褐锈迹质感）                           -->
      <!-- ====================================================== -->
      <rect class="pet-robot__body" x="26" y="44" width="88" height="64" rx="10" ry="10" fill="url(#walleBodyGrad)" stroke="#8B6914" stroke-width="1.5" />
      <!-- 胸前面板（凹陷感） -->
      <rect x="38" y="56" width="64" height="44" rx="6" ry="6" fill="url(#wallePanelGrad)" opacity="0.55" />
      <!-- 面板接缝线 -->
      <line x1="70" y1="56" x2="70" y2="100" stroke="#6A4A10" stroke-width="1" opacity="0.4" />
      <!-- 左指示灯（绿） -->
      <circle class="pet-robot__led pet-robot__led--green" cx="48" cy="66" r="2.5" fill="#67C23A" />
      <!-- 右指示灯（蓝） -->
      <circle class="pet-robot__led pet-robot__led--blue" cx="92" cy="66" r="2.5" fill="#4CC2FF" />
      <!-- 胸前铭牌 -->
      <rect x="54" y="88" width="32" height="8" rx="2" fill="#6A4A10" opacity="0.7" />
      <!-- 机身侧边螺丝 -->
      <circle cx="32" cy="50" r="1.5" fill="#6A4A10" />
      <circle cx="108" cy="50" r="1.5" fill="#6A4A10" />
      <circle cx="32" cy="102" r="1.5" fill="#6A4A10" />
      <circle cx="108" cy="102" r="1.5" fill="#6A4A10" />

      <!-- ====================================================== -->
      <!-- 颈部（可伸缩关节）                                      -->
      <!-- ====================================================== -->
      <rect x="56" y="38" width="28" height="8" rx="2" fill="#9A9A9A" stroke="#6A6A6A" stroke-width="0.8" />
      <circle cx="70" cy="42" r="3" fill="#6A6A6A" />

      <!-- ====================================================== -->
      <!-- 头部底座（连接双眼筒）                                   -->
      <!-- ====================================================== -->
      <rect x="40" y="28" width="60" height="12" rx="4" ry="4" fill="#B8B8B8" stroke="#8A8A8A" stroke-width="1" />

      <!-- ====================================================== -->
      <!-- 双筒望远镜眼睛（瓦力最显著特征：大圆筒 + LED 透镜）       -->
      <!-- ====================================================== -->
      <g class="pet-robot__eyes">
        <!-- 左眼筒 -->
        <ellipse class="pet-robot__eye-tube pet-robot__eye-tube--left" cx="52" cy="22" rx="12" ry="11" fill="#2A2A2A" stroke="#1A1A1A" stroke-width="1.5" />
        <!-- 透镜外圈 -->
        <circle cx="52" cy="22" r="8" fill="#1A1A1A" />
        <!-- LED 透镜 -->
        <circle class="pet-robot__eye pet-robot__eye--left" cx="52" cy="22" r="5" fill="#4CC2FF" />
        <!-- 透镜光晕 -->
        <circle class="pet-robot__eye-glow pet-robot__eye-glow--left" cx="52" cy="22" r="7" fill="#4CC2FF" opacity="0.25" />
        <!-- 高光 -->
        <circle class="pet-robot__eye-shine pet-robot__eye-shine--left" cx="54" cy="20" r="1.8" fill="#FFFFFF" opacity="0.85" />
        <!-- 眼筒顶部螺丝 -->
        <circle cx="52" cy="12" r="1.5" fill="#6A6A6A" />

        <!-- 右眼筒 -->
        <ellipse class="pet-robot__eye-tube pet-robot__eye-tube--right" cx="88" cy="22" rx="12" ry="11" fill="#2A2A2A" stroke="#1A1A1A" stroke-width="1.5" />
        <circle cx="88" cy="22" r="8" fill="#1A1A1A" />
        <circle class="pet-robot__eye pet-robot__eye--right" cx="88" cy="22" r="5" fill="#4CC2FF" />
        <circle class="pet-robot__eye-glow pet-robot__eye-glow--right" cx="88" cy="22" r="7" fill="#4CC2FF" opacity="0.25" />
        <circle class="pet-robot__eye-shine pet-robot__eye-shine--right" cx="90" cy="20" r="1.8" fill="#FFFFFF" opacity="0.85" />
        <circle cx="88" cy="12" r="1.5" fill="#6A6A6A" />

        <!-- 笑眼（happy 状态，弯弧） -->
        <path class="pet-robot__eye-smile pet-robot__eye-smile--left" d="M 46 23 Q 52 17 58 23" fill="none" stroke="#4CC2FF" stroke-width="3" stroke-linecap="round" />
        <path class="pet-robot__eye-smile pet-robot__eye-smile--right" d="M 82 23 Q 88 17 94 23" fill="none" stroke="#4CC2FF" stroke-width="3" stroke-linecap="round" />
      </g>

      <!-- ====================================================== -->
      <!-- 太阳能板（头顶折叠状态）                                 -->
      <!-- ====================================================== -->
      <g class="pet-robot__solar">
        <rect x="44" y="6" width="52" height="5" rx="1" fill="url(#walleSolarGrad)" stroke="#1A3A5A" stroke-width="0.5" />
        <!-- 太阳能板网格线 -->
        <line x1="57" y1="6" x2="57" y2="11" stroke="#1A3A5A" stroke-width="0.6" opacity="0.6" />
        <line x1="70" y1="6" x2="70" y2="11" stroke="#1A3A5A" stroke-width="0.6" opacity="0.6" />
        <line x1="83" y1="6" x2="83" y2="11" stroke="#1A3A5A" stroke-width="0.6" opacity="0.6" />
      </g>

      <!-- ====================================================== -->
      <!-- 天线 + 红色信号灯（顶部）                                -->
      <!-- ====================================================== -->
      <line x1="70" y1="6" x2="70" y2="2" stroke="#8A8A8A" stroke-width="1.5" stroke-linecap="round" />
      <circle class="pet-robot__antenna" cx="70" cy="1" r="2.5" fill="#FF6B6B" />

      <!-- ====================================================== -->
      <!-- 状态装饰：提醒牌子（reminding 状态显示，头顶上方）        -->
      <!-- ====================================================== -->
      <g class="pet-robot__sign">
        <line x1="70" y1="14" x2="70" y2="20" stroke="#8B5A2B" stroke-width="2" stroke-linecap="round" />
        <rect x="56" y="0" width="28" height="14" rx="5" ry="5" fill="#FF6B6B" />
        <text x="70" y="11" text-anchor="middle" font-size="11" font-weight="700" fill="#FFFFFF" font-family="Arial, sans-serif">!</text>
      </g>

      <!-- ====================================================== -->
      <!-- 状态装饰：Z 字（sleeping 状态显示）                     -->
      <!-- ====================================================== -->
      <g class="pet-robot__zzz">
        <text class="pet-robot__z pet-robot__z--1" x="100" y="26" font-size="11" font-weight="700" fill="#9AA5B1" font-family="Arial, sans-serif">Z</text>
        <text class="pet-robot__z pet-robot__z--2" x="110" y="16" font-size="15" font-weight="700" fill="#9AA5B1" font-family="Arial, sans-serif">Z</text>
        <text class="pet-robot__z pet-robot__z--3" x="121" y="5" font-size="19" font-weight="700" fill="#9AA5B1" font-family="Arial, sans-serif">Z</text>
      </g>
    </svg>
  </div>
</template>

<script setup>
defineProps({
  state: {
    type: String,
    default: 'idle',
    validator: (val) => ['idle', 'reminding', 'happy', 'sleeping'].includes(val)
  }
})
</script>

<style scoped lang="scss">
.pet-robot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;

  &__svg {
    width: 100%;
    height: 100%;
    display: block;
    background: transparent;
    transition: transform var(--pet-motion-normal, 250ms) ease;
    animation: robot-hover 3s ease-in-out infinite;
  }
}

// 笑眼默认隐藏
.pet-robot__eye-smile {
  opacity: 0;
}

// 状态装饰默认隐藏
.pet-robot__sign {
  opacity: 0;
  transition: opacity var(--pet-motion-normal, 250ms) ease;
}

.pet-robot__zzz {
  opacity: 0;
}

// idle 状态：LED 眼闪烁 + 天线红灯闪烁 + 指示灯呼吸
.pet-robot--idle {
  .pet-robot__eye {
    animation: robot-blink-led 4s ease-in-out infinite;
    transform-origin: center;
    transform-box: fill-box;
  }
  .pet-robot__eye-glow {
    animation: robot-pulse 3s ease-in-out infinite;
    transform-origin: center;
    transform-box: fill-box;
  }
  .pet-robot__antenna {
    animation: robot-blink-led 2s ease-in-out infinite;
    transform-origin: center;
    transform-box: fill-box;
  }
  .pet-robot__led--green {
    animation: robot-led-breath 2.5s ease-in-out infinite;
    transform-origin: center;
    transform-box: fill-box;
  }
  .pet-robot__led--blue {
    animation: robot-led-breath 3s ease-in-out infinite;
    animation-delay: 1.5s;
    transform-origin: center;
    transform-box: fill-box;
  }
}

// reminding 状态：弹跳 + 提醒牌子 + 眼睛快闪 + 天线快闪
.pet-robot--reminding {
  .pet-robot__svg {
    animation: robot-bounce 0.6s ease-in-out infinite;
  }
  .pet-robot__sign {
    opacity: 1;
    animation: robot-sign-bob 0.6s ease-in-out infinite;
  }
  .pet-robot__eye-glow {
    animation: robot-pulse 0.5s ease-in-out infinite;
    transform-origin: center;
    transform-box: fill-box;
  }
  .pet-robot__antenna {
    animation: robot-blink-fast 0.3s ease-in-out infinite;
    transform-origin: center;
    transform-box: fill-box;
  }
  .pet-robot__led--green,
  .pet-robot__led--blue {
    animation: robot-blink-fast 0.4s ease-in-out infinite;
    transform-origin: center;
    transform-box: fill-box;
  }
}

// happy 状态：笑眼 + 左右摇摆 + 天线快闪
.pet-robot--happy {
  .pet-robot__eye,
  .pet-robot__eye-glow,
  .pet-robot__eye-shine {
    opacity: 0;
  }
  .pet-robot__eye-smile {
    opacity: 1;
  }
  .pet-robot__svg {
    animation: robot-wobble 1.2s ease-in-out infinite;
  }
  .pet-robot__antenna {
    animation: robot-blink-fast 0.3s ease-in-out infinite;
    transform-origin: center;
    transform-box: fill-box;
  }
  .pet-robot__led--green,
  .pet-robot__led--blue {
    animation: robot-led-breath 0.6s ease-in-out infinite;
    transform-origin: center;
    transform-box: fill-box;
  }
}

// sleeping 状态：眼筒下垂 + Z字 + 缓慢呼吸
.pet-robot--sleeping {
  .pet-robot__eye-tube {
    transform: scaleY(0.6);
    transform-origin: center;
    transform-box: fill-box;
  }
  .pet-robot__eye,
  .pet-robot__eye-glow,
  .pet-robot__eye-shine {
    opacity: 0.3;
  }
  .pet-robot__body {
    opacity: 0.85;
  }
  .pet-robot__zzz {
    opacity: 1;
  }
  .pet-robot__z {
    animation: robot-z-float 2.4s ease-in-out infinite;
    opacity: 0;
    &--1 { animation-delay: 0s; }
    &--2 { animation-delay: 0.8s; }
    &--3 { animation-delay: 1.6s; }
  }
  .pet-robot__svg {
    animation: robot-hover 5s ease-in-out infinite;
  }
}

// 关键帧
@keyframes robot-hover {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2px); }
}
@keyframes robot-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}
@keyframes robot-blink-led {
  0%, 90%, 100% { opacity: 1; }
  95% { opacity: 0.2; }
}
@keyframes robot-blink-fast {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
@keyframes robot-pulse {
  0%, 100% { opacity: 0.25; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(1.3); }
}
@keyframes robot-led-breath {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}
@keyframes robot-sign-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}
@keyframes robot-wobble {
  0%, 100% { transform: rotate(0deg); }
  25% { transform: rotate(-5deg); }
  75% { transform: rotate(5deg); }
}
@keyframes robot-z-float {
  0% { opacity: 0; transform: translateY(0); }
  30% { opacity: 1; }
  100% { opacity: 0; transform: translateY(-12px); }
}
</style>