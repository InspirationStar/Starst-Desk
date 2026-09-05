<!--
  桌宠熊猫角色组件
  职责：内联 SVG 绘制一只抱竹子的卡通大熊猫，根据状态切换 CSS 动画
  Props:
    - state: 当前状态（idle / reminding / happy / sleeping）
  设计参考：参考瓦力（WALL-E）的精致化表现手法 + Wikipedia/National Geographic 熊猫特征
    - 头大身圆的卡通比例，圆滚滚造型
    - 白色头身 + 黑色耳朵/眼斑/肩带/四肢
    - 眼斑向下外侧倾斜（真实熊猫"泪滴"形眼斑）
    - 黑色肩带从肩膀延伸到前肢
    - 坐姿，后腿露出身体底部，怀抱竹子
    - 竹子斜放，有竹节和竹叶，带渐变质感
    - 底部地面光晕：营造"悬浮"感，与瓦力悬浮光圈呼应
    - viewBox 0 0 140 140，正面坐姿视角
-->
<template>
  <div class="pet-character" :class="`pet-character--${state}`">
    <svg class="pet-character__svg" viewBox="0 0 140 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <!-- ====================================================== -->
      <!-- 渐变定义：竹子渐变 / 身体光影 / 眼睛高光                 -->
      <!-- ====================================================== -->
      <defs>
        <!-- 竹子：翠绿到深绿的纵向渐变 -->
        <linearGradient id="pandaBambooGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#7CCB54" />
          <stop offset="50%" stop-color="#4CAF50" />
          <stop offset="100%" stop-color="#2E7D32" />
        </linearGradient>
        <!-- 竹子叶片渐变 -->
        <linearGradient id="pandaLeafGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#8AD36A" />
          <stop offset="100%" stop-color="#43A047" />
        </linearGradient>
        <!-- 身体：顶部受光、底部微暗的立体渐变 -->
        <radialGradient id="pandaBodyGrad" cx="0.5" cy="0.3" r="0.85">
          <stop offset="0%" stop-color="#FFFFFF" />
          <stop offset="75%" stop-color="#FBFBFB" />
          <stop offset="100%" stop-color="#EFEFEF" />
        </radialGradient>
        <!-- 头部：同样轻微立体感 -->
        <radialGradient id="pandaHeadGrad" cx="0.5" cy="0.32" r="0.8">
          <stop offset="0%" stop-color="#FFFFFF" />
          <stop offset="80%" stop-color="#FAFAFA" />
          <stop offset="100%" stop-color="#EFEFEF" />
        </radialGradient>
      </defs>

      <!-- ====================================================== -->
      <!-- 地面光晕（底部）：参考瓦力的悬浮光圈，营造桌宠浮空感      -->
      <!-- ====================================================== -->
      <ellipse class="pet-character__glow" cx="70" cy="132" rx="30" ry="5" fill="#1A1A1A" opacity="0.10" />

      <!-- ====================================================== -->
      <!-- 后腿（黑色，坐姿底部露出身体之外）                        -->
      <!-- z-order：最先绘制，被身体部分遮挡，底部露出               -->
      <!-- ====================================================== -->
      <ellipse class="pet-character__leg pet-character__leg--left" cx="42" cy="126" rx="14" ry="8" fill="#1A1A1A" />
      <ellipse class="pet-character__leg pet-character__leg--right" cx="98" cy="126" rx="14" ry="8" fill="#1A1A1A" />
      <!-- 脚掌肉垫（粉色） -->
      <ellipse cx="42" cy="131" rx="7" ry="2.5" fill="#FFB6C1" opacity="0.4" />
      <ellipse cx="98" cy="131" rx="7" ry="2.5" fill="#FFB6C1" opacity="0.4" />

      <!-- ====================================================== -->
      <!-- 身体（白色圆胖，坐姿，底部稍平，带径向渐变立体感）          -->
      <!-- ====================================================== -->
      <path class="pet-character__body" d="M 22 88 Q 22 58 70 58 Q 118 58 118 88 L 118 110 Q 118 120 100 120 L 40 120 Q 22 120 22 110 Z" fill="url(#pandaBodyGrad)" />
      <!-- 身体底部微阴影（增加立体感） -->
      <path d="M 26 110 Q 70 119 114 110 L 114 116 Q 70 118 26 116 Z" fill="#E0E0E0" opacity="0.35" />

      <!-- ====================================================== -->
      <!-- 黑色肩带（熊猫标志性特征：肩膀到前肢的黑色区域）            -->
      <!-- ====================================================== -->
      <path class="pet-character__shoulder pet-character__shoulder--left" d="M 24 62 Q 20 70 22 82 Q 27 91 35 89 Q 33 78 30 66 Z" fill="#1A1A1A" />
      <path class="pet-character__shoulder pet-character__shoulder--right" d="M 116 62 Q 120 70 118 82 Q 113 91 105 89 Q 107 78 110 66 Z" fill="#1A1A1A" />

      <!-- ====================================================== -->
      <!-- 竹子（绿色，斜放在胸前，被双手抱着，渐变质感）             -->
      <!-- ====================================================== -->
      <g class="pet-character__bamboo" transform="rotate(-6 70 86)">
        <!-- 竹子主体 -->
        <rect x="20" y="84" width="100" height="9" rx="4.5" fill="url(#pandaBambooGrad)" />
        <!-- 竹节（深绿色横线） -->
        <line x1="40" y1="84" x2="40" y2="93" stroke="#1B5E20" stroke-width="2" stroke-linecap="round" />
        <line x1="60" y1="84" x2="60" y2="93" stroke="#1B5E20" stroke-width="2" stroke-linecap="round" />
        <line x1="80" y1="84" x2="80" y2="93" stroke="#1B5E20" stroke-width="2" stroke-linecap="round" />
        <line x1="98" y1="84" x2="98" y2="93" stroke="#1B5E20" stroke-width="2" stroke-linecap="round" />
        <!-- 竹节间高光 -->
        <line x1="50" y1="86" x2="50" y2="91" stroke="#A5D6A7" stroke-width="1.5" stroke-linecap="round" opacity="0.7" />
        <line x1="70" y1="86" x2="70" y2="91" stroke="#A5D6A7" stroke-width="1.5" stroke-linecap="round" opacity="0.7" />
        <line x1="89" y1="86" x2="89" y2="91" stroke="#A5D6A7" stroke-width="1.5" stroke-linecap="round" opacity="0.7" />
        <!-- 竹叶（右端两片） -->
        <path d="M 118 84 Q 126 76 130 80 Q 126 87 118 89 Z" fill="url(#pandaLeafGrad)" />
        <path d="M 118 93 Q 128 96 130 103 Q 122 100 118 93 Z" fill="url(#pandaLeafGrad)" />
        <!-- 竹叶（左端一片） -->
        <path d="M 22 84 Q 12 79 10 84 Q 14 89 22 88 Z" fill="url(#pandaLeafGrad)" />
      </g>

      <!-- ====================================================== -->
      <!-- 前肢/手臂（黑色，从肩带伸出环抱竹子）                     -->
      <!-- ====================================================== -->
      <path class="pet-character__arm pet-character__arm--left" d="M 26 66 Q 16 72 18 86 Q 22 95 34 93 Q 38 91 36 84 Q 34 77 30 70 Z" fill="#1A1A1A" />
      <path class="pet-character__arm pet-character__arm--right" d="M 114 66 Q 124 72 122 86 Q 118 95 106 93 Q 102 91 104 84 Q 106 77 110 70 Z" fill="#1A1A1A" />
      <!-- 掌心肉垫（粉色） -->
      <ellipse cx="34" cy="91" rx="5" ry="3" fill="#FFB6C1" opacity="0.45" />
      <ellipse cx="106" cy="91" rx="5" ry="3" fill="#FFB6C1" opacity="0.45" />

      <!-- ====================================================== -->
      <!-- 头部（白色大圆头，略呈梨形——下部稍宽体现脸颊，带渐变）      -->
      <!-- ====================================================== -->
      <path class="pet-character__head" d="M 40 40 Q 40 12 70 12 Q 100 12 100 40 Q 100 55 89 59 Q 70 63 51 59 Q 40 55 40 40 Z" fill="url(#pandaHeadGrad)" />

      <!-- ====================================================== -->
      <!-- 耳朵（黑色圆形，紧贴头顶两侧，带轻微高光）                 -->
      <!-- ====================================================== -->
      <circle class="pet-character__ear pet-character__ear--left" cx="46" cy="16" r="11" fill="#1A1A1A" />
      <circle class="pet-character__ear pet-character__ear--right" cx="94" cy="16" r="11" fill="#1A1A1A" />
      <!-- 内耳（深灰色） -->
      <circle class="pet-character__ear-inner pet-character__ear-inner--left" cx="47" cy="18" r="6" fill="#2A2A2A" />
      <circle class="pet-character__ear-inner pet-character__ear-inner--right" cx="93" cy="18" r="6" fill="#2A2A2A" />

      <!-- ====================================================== -->
      <!-- 眼斑（黑色"泪滴"形，向下外侧倾斜——熊猫标志性特征）         -->
      <!-- ====================================================== -->
      <ellipse class="pet-character__eye-patch pet-character__eye-patch--left" cx="55" cy="37" rx="7" ry="11" fill="#1A1A1A" transform="rotate(18 55 37)" />
      <ellipse class="pet-character__eye-patch pet-character__eye-patch--right" cx="85" cy="37" rx="7" ry="11" fill="#1A1A1A" transform="rotate(-18 85 37)" />

      <!-- ====================================================== -->
      <!-- 眼睛（在眼斑内，白眼+黑瞳+高光，黑瞳带微光晕）             -->
      <!-- ====================================================== -->
      <g class="pet-character__eyes">
        <!-- 黑瞳光晕（参考瓦力 LED 光晕的柔和感） -->
        <circle class="pet-character__eye-halo pet-character__eye-halo--left" cx="56" cy="36" r="4.6" fill="#3A3A3A" opacity="0.35" />
        <circle class="pet-character__eye-halo pet-character__eye-halo--right" cx="84" cy="36" r="4.6" fill="#3A3A3A" opacity="0.35" />
        <!-- 左眼 -->
        <circle class="pet-character__eye pet-character__eye--left" cx="56" cy="36" r="3.6" fill="#FFFFFF" />
        <circle cx="56.5" cy="37" r="2.3" fill="#1A1A1A" />
        <circle class="pet-character__eye-shine pet-character__eye-shine--left" cx="57.4" cy="35.4" r="1" fill="#FFFFFF" />
        <!-- 右眼 -->
        <circle class="pet-character__eye pet-character__eye--right" cx="84" cy="36" r="3.6" fill="#FFFFFF" />
        <circle cx="83.5" cy="37" r="2.3" fill="#1A1A1A" />
        <circle class="pet-character__eye-shine pet-character__eye-shine--right" cx="84.4" cy="35.4" r="1" fill="#FFFFFF" />
        <!-- happy 状态：弯弯笑眼 -->
        <path class="pet-character__eye-smile pet-character__eye-smile--left" d="M 52 37 Q 56 31 60 37" fill="none" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round" />
        <path class="pet-character__eye-smile pet-character__eye-smile--right" d="M 80 37 Q 84 31 88 37" fill="none" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round" />
      </g>

      <!-- ====================================================== -->
      <!-- 鼻子（黑色椭圆）                                         -->
      <!-- ====================================================== -->
      <ellipse class="pet-character__nose" cx="70" cy="47" rx="3" ry="2.2" fill="#1A1A1A" />

      <!-- ====================================================== -->
      <!-- 嘴巴（微笑曲线）                                         -->
      <!-- ====================================================== -->
      <path class="pet-character__mouth" d="M 70 49 Q 65 56 61 53 M 70 49 Q 75 56 79 53" fill="none" stroke="#1A1A1A" stroke-width="1.6" stroke-linecap="round" />

      <!-- ====================================================== -->
      <!-- 腮红（粉色，眼斑外侧）                                    -->
      <!-- ====================================================== -->
      <ellipse class="pet-character__blush pet-character__blush--left" cx="42" cy="48" rx="4.6" ry="2.8" fill="#FFB6C1" opacity="0.55" />
      <ellipse class="pet-character__blush pet-character__blush--right" cx="98" cy="48" rx="4.6" ry="2.8" fill="#FFB6C1" opacity="0.55" />

      <!-- ====================================================== -->
      <!-- 状态装饰：提醒牌子（reminding 状态显示，固定在头顶上方）   -->
      <!-- ====================================================== -->
      <g class="pet-character__sign">
        <line x1="70" y1="18" x2="70" y2="9" stroke="#8B5A2B" stroke-width="2.5" stroke-linecap="round" />
        <rect x="57" y="-6" width="26" height="15" rx="6" ry="6" fill="#FF6B6B" />
        <text x="70" y="6" text-anchor="middle" font-size="12" font-weight="700" fill="#FFFFFF" font-family="Arial, sans-serif">!</text>
      </g>

      <!-- ====================================================== -->
      <!-- 状态装饰：Z 字（sleeping 状态显示）                       -->
      <!-- ====================================================== -->
      <g class="pet-character__zzz">
        <text class="pet-character__z pet-character__z--1" x="98" y="24" font-size="11" font-weight="700" fill="#9AA5B1" font-family="Arial, sans-serif">Z</text>
        <text class="pet-character__z pet-character__z--2" x="108" y="13" font-size="15" font-weight="700" fill="#9AA5B1" font-family="Arial, sans-serif">Z</text>
        <text class="pet-character__z pet-character__z--3" x="119" y="2" font-size="19" font-weight="700" fill="#9AA5B1" font-family="Arial, sans-serif">Z</text>
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
.pet-character {
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
    animation: pet-float 4s ease-in-out infinite;
  }
}

.pet-character__eye-smile {
  opacity: 0;
}

.pet-character__sign {
  opacity: 0;
  transition: opacity var(--pet-motion-normal, 250ms) ease;
}

.pet-character__zzz {
  opacity: 0;
}

// idle 状态：呼吸 + 眨眼 + 竹子微晃 + 耳朵轻动
.pet-character--idle {
  .pet-character__body,
  .pet-character__head {
    animation: pet-breathe 3s ease-in-out infinite;
    transform-origin: 70px 84px;
  }
  .pet-character__eye,
  .pet-character__eye-shine,
  .pet-character__eye-halo {
    animation: pet-blink 4s ease-in-out infinite;
    transform-origin: center;
    transform-box: fill-box;
  }
  .pet-character__bamboo {
    animation: pet-bamboo-sway 5s ease-in-out infinite;
    transform-origin: 70px 86px;
  }
  .pet-character__ear {
    animation: pet-ear-twitch 6s ease-in-out infinite;
    transform-origin: center;
    transform-box: fill-box;
    &--right {
      animation-delay: 3s;
    }
  }
}

// reminding 状态：弹跳 + 提醒牌子 + 光晕脉冲
.pet-character--reminding {
  .pet-character__svg {
    animation: pet-bounce 0.6s ease-in-out infinite;
  }
  .pet-character__sign {
    opacity: 1;
    animation: pet-sign-bob 0.6s ease-in-out infinite;
  }
  .pet-character__bamboo {
    animation: pet-bamboo-sway 0.8s ease-in-out infinite;
    transform-origin: 70px 86px;
  }
  .pet-character__eye-halo {
    animation: pet-halo-pulse 0.6s ease-in-out infinite;
    transform-origin: center;
    transform-box: fill-box;
  }
}

// happy 状态：弯弯笑眼 + 轻摆 + 腮红增强
.pet-character--happy {
  .pet-character__eye,
  .pet-character__eye-shine,
  .pet-character__eye-halo {
    opacity: 0;
  }
  .pet-character__eye-smile {
    opacity: 1;
  }
  .pet-character__svg {
    animation: pet-wobble 1.2s ease-in-out infinite;
  }
  .pet-character__bamboo {
    animation: pet-bamboo-sway 1s ease-in-out infinite;
    transform-origin: 70px 86px;
  }
  .pet-character__blush {
    animation: pet-blush-glow 1.2s ease-in-out infinite;
    transform-origin: center;
    transform-box: fill-box;
  }
}

// sleeping 状态：闭眼 + Z字 + 缓慢呼吸
.pet-character--sleeping {
  .pet-character__eye,
  .pet-character__eye-halo {
    transform: scaleY(0.1);
    transform-origin: center;
    transform-box: fill-box;
  }
  .pet-character__eye-shine {
    opacity: 0;
  }
  .pet-character__zzz {
    opacity: 1;
  }
  .pet-character__z {
    animation: pet-z-float 2.4s ease-in-out infinite;
    opacity: 0;
    &--1 { animation-delay: 0s; }
    &--2 { animation-delay: 0.8s; }
    &--3 { animation-delay: 1.6s; }
  }
  .pet-character__body,
  .pet-character__head {
    animation: pet-breathe 4s ease-in-out infinite;
    transform-origin: 70px 84px;
  }
  .pet-character__svg {
    animation: none;
  }
}

// 关键帧
@keyframes pet-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2px); }
}
@keyframes pet-breathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.03); }
}
@keyframes pet-blink {
  0%, 92%, 100% { transform: scaleY(1); }
  96% { transform: scaleY(0.1); }
}
@keyframes pet-ear-twitch {
  0%, 92%, 100% { transform: rotate(0deg); }
  94% { transform: rotate(-6deg); }
  96% { transform: rotate(4deg); }
  98% { transform: rotate(0deg); }
}
@keyframes pet-halo-pulse {
  0%, 100% { opacity: 0.25; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(1.35); }
}
@keyframes pet-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-7px); }
}
@keyframes pet-wobble {
  0%, 100% { transform: rotate(0deg); }
  25% { transform: rotate(-4deg); }
  75% { transform: rotate(4deg); }
}
@keyframes pet-sign-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}
@keyframes pet-bamboo-sway {
  0%, 100% { transform: rotate(-2deg); }
  50% { transform: rotate(2deg); }
}
@keyframes pet-blush-glow {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}
@keyframes pet-z-float {
  0% { opacity: 0; transform: translateY(0); }
  30% { opacity: 1; }
  100% { opacity: 0; transform: translateY(-12px); }
}
</style>