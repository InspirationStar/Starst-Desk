// ============================================================
// 天气 Store
// 职责：管理天气数据、城市、主题皮肤
// ============================================================

import { defineStore } from 'pinia'
import dayjs from 'dayjs'
import { weatherApi } from '@/utils/ipc-client'

// 天气状况图标映射
const weatherIcons = {
  'clear': 'Sun',
  'partly-cloudy': 'Cloudy',
  'cloudy': 'Cloud',
  'rain': 'Rainbow',
  'snow': 'Snowflake',
  'thunder': 'Lightning',
  'fog': 'WeatherFog',
  'wind': 'WindPower',
  'default': 'WeatherSunset'
}

// 天气皮肤颜色映射
const weatherSkinColors = {
  'clear': {
    light: { primary: '#FF9800', secondary: '#FFE0B2', bg: 'linear-gradient(135deg, #FFF3E0 0%, #FFE0B2 100%)' },
    dark: { primary: '#FFB74D', secondary: '#FF8F00', bg: 'linear-gradient(135deg, #3E2723 0%, #5D4037 100%)' }
  },
  'partly-cloudy': {
    light: { primary: '#2196F3', secondary: '#BBDEFB', bg: 'linear-gradient(135deg, #E3F2FD 0%, #BBDEFB 100%)' },
    dark: { primary: '#64B5F6', secondary: '#1976D2', bg: 'linear-gradient(135deg, #1A237E 0%, #283593 100%)' }
  },
  'cloudy': {
    light: { primary: '#757575', secondary: '#E0E0E0', bg: 'linear-gradient(135deg, #F5F5F5 0%, #E0E0E0 100%)' },
    dark: { primary: '#9E9E9E', secondary: '#616161', bg: 'linear-gradient(135deg, #424242 0%, #616161 100%)' }
  },
  'rain': {
    light: { primary: '#1976D2', secondary: '#90CAF9', bg: 'linear-gradient(135deg, #E3F2FD 0%, #BBDEFB 100%)' },
    dark: { primary: '#42A5F5', secondary: '#1565C0', bg: 'linear-gradient(135deg, #0D47A1 0%, #1565C0 100%)' }
  },
  'snow': {
    light: { primary: '#5C6BC0', secondary: '#C5CAE9', bg: 'linear-gradient(135deg, #E8EAF6 0%, #C5CAE9 100%)' },
    dark: { primary: '#7986CB', secondary: '#3949AB', bg: 'linear-gradient(135deg, #1A237E 0%, #283593 100%)' }
  },
  'thunder': {
    light: { primary: '#424242', secondary: '#9E9E9E', bg: 'linear-gradient(135deg, #ECEFF1 0%, #CFD8DC 100%)' },
    dark: { primary: '#757575', secondary: '#424242', bg: 'linear-gradient(135deg, #263238 0%, #37474F 100%)' }
  },
  'fog': {
    light: { primary: '#9E9E9E', secondary: '#E0E0E0', bg: 'linear-gradient(135deg, #FAFAFA 0%, #EEEEEE 100%)' },
    dark: { primary: '#757575', secondary: '#616161', bg: 'linear-gradient(135deg, #424242 0%, #616161 100%)' }
  }
}

export const useWeatherStore = defineStore('weather', {
  state: () => ({
    // 当前城市
    currentCity: 'Beijing',
    // 当前天气数据
    weatherData: null,
    // 小时预报
    hourlyForecast: [],
    // 日预报
    dailyForecast: [],
    // 温度单位：'metric'( Celsius) | 'imperial'( Fahrenheit)
    units: 'metric',
    // 主题皮肤：'standard' | 'conditional'
    skin: 'conditional',
    // 视图模式：'day' | 'week'
    viewMode: 'day',
    // 加载状态
    isLoading: false,
    // 错误信息
    error: null,
    // 最后更新时间
    lastUpdated: null
  }),

  getters: {
    /**
     * 当前天气图标
     */
    currentWeatherIcon (state) {
      if (!state.weatherData) return weatherIcons['default']
      const condition = state.weatherData.condition?.toLowerCase() || ''
      if (condition.includes('clear') || condition.includes('sunny')) return weatherIcons['clear']
      if (condition.includes('partly') || condition.includes('cloud')) return weatherIcons['partly-cloudy']
      if (condition.includes('cloud')) return weatherIcons['cloudy']
      if (condition.includes('rain')) return weatherIcons['rain']
      if (condition.includes('snow')) return weatherIcons['snow']
      if (condition.includes('thunder')) return weatherIcons['thunder']
      if (condition.includes('fog') || condition.includes('mist')) return weatherIcons['fog']
      return weatherIcons['default']
    },

    /**
     * 当前皮肤颜色
     */
    skinColors (state) {
      if (!state.skin || state.skin === 'standard') {
        return {
          primary: 'var(--widget-text, #1A1A1A)',
          secondary: 'var(--widget-text-secondary, #5A5A5A)',
          bg: 'transparent'
        }
      }

      const condition = state.weatherData?.condition?.toLowerCase() || 'clear'
      let skinKey = 'clear'
      if (condition.includes('rain')) skinKey = 'rain'
      else if (condition.includes('snow')) skinKey = 'snow'
      else if (condition.includes('thunder')) skinKey = 'thunder'
      else if (condition.includes('fog') || condition.includes('mist')) skinKey = 'fog'
      else if (condition.includes('cloud')) skinKey = 'cloudy'
      else if (condition.includes('partly')) skinKey = 'partly-cloudy'

      const isDark = document.documentElement.classList.contains('dark')
      return weatherSkinColors[skinKey]?.[isDark ? 'dark' : 'light'] || weatherSkinColors['clear'][isDark ? 'dark' : 'light']
    },

    /**
     * 温度显示
     */
    temperatureDisplay (state) {
      if (!state.weatherData) return '--°'
      const temp = state.units === 'metric' ? state.weatherData.temperature : 
        (state.weatherData.temperature * 9/5 + 32)
      return `${Math.round(temp)}°`
    },

    /**
     * 体感温度显示
     */
    feelsLikeDisplay (state) {
      if (!state.weatherData) return '--°'
      const temp = state.units === 'metric' ? state.weatherData.feelsLike : 
        (state.weatherData.feelsLike * 9/5 + 32)
      return `${Math.round(temp)}°`
    },

    /**
     * 湿度显示
     */
    humidityDisplay (state) {
      if (!state.weatherData) return '--%'
      return `${state.weatherData.humidity}%`
    },

    /**
     * 风速显示
     */
    windDisplay (state) {
      if (!state.weatherData) return '-- km/h'
      return `${state.weatherData.windSpeed} km/h`
    }
  },

  actions: {
    /**
     * 加载天气数据
     * @param {string} city
     * @returns {Promise<object>}
     */
    async loadWeather (city) {
      this.isLoading = true
      this.error = null
      this.currentCity = city

      try {
        const result = await weatherApi.getWeather(city, this.units)
        this.weatherData = result.current
        this.hourlyForecast = result.hourly || []
        this.dailyForecast = result.daily || []
        this.lastUpdated = new Date().toISOString()

        return this.weatherData
      } catch (err) {
        this.error = err.message
        console.error('[WeatherStore] loadWeather 失败:', err)
        throw err
      } finally {
        this.isLoading = false
      }
    },

    /**
     * 切换城市
     * @param {string} city
     */
    async switchCity (city) {
      if (city !== this.currentCity) {
        await this.loadWeather(city)
      }
    },

    /**
     * 搜索城市
     * @param {string} query
     * @returns {Promise<Array>}
     */
    async searchCities (query) {
      try {
        const result = await weatherApi.searchCities(query)
        return result.cities || []
      } catch (err) {
        console.error('[WeatherStore] searchCities 失败:', err)
        return []
      }
    },

    /**
     * 切换温度单位
     */
    toggleUnits () {
      this.units = this.units === 'metric' ? 'imperial' : 'metric'
      if (this.weatherData) {
        this.loadWeather(this.currentCity)
      }
    },

    /**
     * 设置主题皮肤
     * @param {'standard'|'conditional'} skin
     */
    setSkin (skin) {
      if (['standard', 'conditional'].includes(skin)) {
        this.skin = skin
      }
    },

    /**
     * 切换视图模式
     * @param {'day'|'week'} mode
     */
    setViewMode (mode) {
      if (['day', 'week'].includes(mode)) {
        this.viewMode = mode
      }
    },

    /**
     * 刷新天气数据
     */
    async refresh () {
      await this.loadWeather(this.currentCity)
    }
  }
})

export default useWeatherStore