// ============================================================
// 天气服务（主进程）
// 职责：获取天气数据、城市搜索、数据缓存
//   - 本地预定义城市列表（中文/英文/拼音/拼音首字母匹配）
//   - Open-Meteo 地理编码 API 并行搜索
//   - 合并去重 + 相关度排序 + 距离排序
//   - 附近热门城市 / 全球热门城市 / 反向地理编码
// ============================================================

const { ipcMain } = require('electron')
const https = require('https')
const fs = require('fs').promises
const path = require('path')
const os = require('os')

// ============================================================
// 配置
// ============================================================

// 天气缓存目录：统一放在应用数据目录 %APPDATA%\StarstDesk 下，便于管理
const CACHE_DIR = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'StarstDesk', 'weather-cache'
)
const CACHE_EXPIRY = 30 * 60 * 1000 // 30 分钟

// 城市数据（内置基础城市列表，向后兼容）
const CITIES_DATA = require('./cities.json')

// ============================================================
// 包含 zh/en/pinyin/lat/lon/countryZh/countryEn/admin1Zh/admin1En
// 覆盖中国主要城市 + 国际主要城市，支持多语言/拼音搜索
// ============================================================
const PREDEFINED_CITIES = [
  { zh: "北京", en: "Beijing", pinyin: "beijing", lat: 39.9042, lon: 116.4074, countryZh: "中国", countryEn: "China", admin1Zh: "北京市", admin1En: "Beijing" },
  { zh: "上海", en: "Shanghai", pinyin: "shanghai", lat: 31.2304, lon: 121.4737, countryZh: "中国", countryEn: "China", admin1Zh: "上海市", admin1En: "Shanghai" },
  { zh: "广州", en: "Guangzhou", pinyin: "guangzhou", lat: 23.1291, lon: 113.2644, countryZh: "中国", countryEn: "China", admin1Zh: "广东省", admin1En: "Guangdong" },
  { zh: "深圳", en: "Shenzhen", pinyin: "shenzhen", lat: 22.5431, lon: 114.0579, countryZh: "中国", countryEn: "China", admin1Zh: "广东省", admin1En: "Guangdong" },
  { zh: "成都", en: "Chengdu", pinyin: "chengdu", lat: 30.5728, lon: 104.0668, countryZh: "中国", countryEn: "China", admin1Zh: "四川省", admin1En: "Sichuan" },
  { zh: "杭州", en: "Hangzhou", pinyin: "hangzhou", lat: 30.2741, lon: 120.1551, countryZh: "中国", countryEn: "China", admin1Zh: "浙江省", admin1En: "Zhejiang" },
  { zh: "武汉", en: "Wuhan", pinyin: "wuhan", lat: 30.5928, lon: 114.3055, countryZh: "中国", countryEn: "China", admin1Zh: "湖北省", admin1En: "Hubei" },
  { zh: "西安", en: "Xi'an", pinyin: "xian", lat: 34.3416, lon: 108.9398, countryZh: "中国", countryEn: "China", admin1Zh: "陕西省", admin1En: "Shaanxi" },
  { zh: "南京", en: "Nanjing", pinyin: "nanjing", lat: 32.0603, lon: 118.7969, countryZh: "中国", countryEn: "China", admin1Zh: "江苏省", admin1En: "Jiangsu" },
  { zh: "重庆", en: "Chongqing", pinyin: "chongqing", lat: 29.563, lon: 106.5516, countryZh: "中国", countryEn: "China", admin1Zh: "重庆市", admin1En: "Chongqing" },
  { zh: "天津", en: "Tianjin", pinyin: "tianjin", lat: 39.3434, lon: 117.3616, countryZh: "中国", countryEn: "China", admin1Zh: "天津市", admin1En: "Tianjin" },
  { zh: "苏州", en: "Suzhou", pinyin: "suzhou", lat: 31.299, lon: 120.5853, countryZh: "中国", countryEn: "China", admin1Zh: "江苏省", admin1En: "Jiangsu" },
  { zh: "长沙", en: "Changsha", pinyin: "changsha", lat: 28.2282, lon: 112.9388, countryZh: "中国", countryEn: "China", admin1Zh: "湖南省", admin1En: "Hunan" },
  { zh: "郑州", en: "Zhengzhou", pinyin: "zhengzhou", lat: 34.7466, lon: 113.6253, countryZh: "中国", countryEn: "China", admin1Zh: "河南省", admin1En: "Henan" },
  { zh: "青岛", en: "Qingdao", pinyin: "qingdao", lat: 36.0671, lon: 120.3826, countryZh: "中国", countryEn: "China", admin1Zh: "山东省", admin1En: "Shandong" },
  { zh: "沈阳", en: "Shenyang", pinyin: "shenyang", lat: 41.8057, lon: 123.4315, countryZh: "中国", countryEn: "China", admin1Zh: "辽宁省", admin1En: "Liaoning" },
  { zh: "大连", en: "Dalian", pinyin: "dalian", lat: 38.914, lon: 121.6147, countryZh: "中国", countryEn: "China", admin1Zh: "辽宁省", admin1En: "Liaoning" },
  { zh: "厦门", en: "Xiamen", pinyin: "xiamen", lat: 24.4798, lon: 118.0894, countryZh: "中国", countryEn: "China", admin1Zh: "福建省", admin1En: "Fujian" },
  { zh: "昆明", en: "Kunming", pinyin: "kunming", lat: 25.0389, lon: 102.7183, countryZh: "中国", countryEn: "China", admin1Zh: "云南省", admin1En: "Yunnan" },
  { zh: "哈尔滨", en: "Harbin", pinyin: "harbin", lat: 45.8038, lon: 126.535, countryZh: "中国", countryEn: "China", admin1Zh: "黑龙江省", admin1En: "Heilongjiang" },
  { zh: "济南", en: "Jinan", pinyin: "jinan", lat: 36.6512, lon: 117.1201, countryZh: "中国", countryEn: "China", admin1Zh: "山东省", admin1En: "Shandong" },
  { zh: "合肥", en: "Hefei", pinyin: "hefei", lat: 31.8206, lon: 117.2272, countryZh: "中国", countryEn: "China", admin1Zh: "安徽省", admin1En: "Anhui" },
  { zh: "福州", en: "Fuzhou", pinyin: "fuzhou", lat: 26.0745, lon: 119.2965, countryZh: "中国", countryEn: "China", admin1Zh: "福建省", admin1En: "Fujian" },
  { zh: "南昌", en: "Nanchang", pinyin: "nanchang", lat: 28.682, lon: 115.8579, countryZh: "中国", countryEn: "China", admin1Zh: "江西省", admin1En: "Jiangxi" },
  { zh: "贵阳", en: "Guiyang", pinyin: "guiyang", lat: 26.647, lon: 106.6302, countryZh: "中国", countryEn: "China", admin1Zh: "贵州省", admin1En: "Guizhou" },
  { zh: "南宁", en: "Nanning", pinyin: "nanning", lat: 22.817, lon: 108.3669, countryZh: "中国", countryEn: "China", admin1Zh: "广西壮族自治区", admin1En: "Guangxi" },
  { zh: "兰州", en: "Lanzhou", pinyin: "lanzou", lat: 36.0611, lon: 103.8343, countryZh: "中国", countryEn: "China", admin1Zh: "甘肃省", admin1En: "Gansu" },
  { zh: "太原", en: "Taiyuan", pinyin: "taiyuan", lat: 37.8706, lon: 112.5489, countryZh: "中国", countryEn: "China", admin1Zh: "山西省", admin1En: "Shanxi" },
  { zh: "石家庄", en: "Shijiazhuang", pinyin: "shijiazhuang", lat: 38.0428, lon: 114.5149, countryZh: "中国", countryEn: "China", admin1Zh: "河北省", admin1En: "Hebei" },
  { zh: "海口", en: "Haikou", pinyin: "haikou", lat: 20.044, lon: 110.199, countryZh: "中国", countryEn: "China", admin1Zh: "海南省", admin1En: "Hainan" },
  { zh: "三亚", en: "Sanya", pinyin: "sanya", lat: 18.2528, lon: 109.5119, countryZh: "中国", countryEn: "China", admin1Zh: "海南省", admin1En: "Hainan" },
  { zh: "拉萨", en: "Lhasa", pinyin: "lasa", lat: 29.65, lon: 91.1, countryZh: "中国", countryEn: "China", admin1Zh: "西藏自治区", admin1En: "Tibet" },
  { zh: "乌鲁木齐", en: "Urumqi", pinyin: "wulumuqi", lat: 43.8256, lon: 87.6168, countryZh: "中国", countryEn: "China", admin1Zh: "新疆维吾尔自治区", admin1En: "Xinjiang" },
  { zh: "呼和浩特", en: "Hohhot", pinyin: "huhehaote", lat: 40.8426, lon: 111.7511, countryZh: "中国", countryEn: "China", admin1Zh: "内蒙古自治区", admin1En: "Inner Mongolia" },
  { zh: "银川", en: "Yinchuan", pinyin: "yinchuan", lat: 38.4872, lon: 106.2309, countryZh: "中国", countryEn: "China", admin1Zh: "宁夏回族自治区", admin1En: "Ningxia" },
  { zh: "西宁", en: "Xining", pinyin: "xining", lat: 36.6171, lon: 101.7782, countryZh: "中国", countryEn: "China", admin1Zh: "青海省", admin1En: "Qinghai" },
  { zh: "香港", en: "Hong Kong", pinyin: "xianggang", lat: 22.3193, lon: 114.1694, countryZh: "中国", countryEn: "China", admin1Zh: "香港特别行政区", admin1En: "Hong Kong" },
  { zh: "澳门", en: "Macau", pinyin: "aomen", lat: 22.1987, lon: 113.5439, countryZh: "中国", countryEn: "China", admin1Zh: "澳门特别行政区", admin1En: "Macau" },
  { zh: "台北", en: "Taipei", pinyin: "taibei", lat: 25.033, lon: 121.5654, countryZh: "中国", countryEn: "China", admin1Zh: "台湾", admin1En: "Taiwan" },
  { zh: "高雄", en: "Kaohsiung", pinyin: "gaoxiong", lat: 22.6273, lon: 120.3014, countryZh: "中国", countryEn: "China", admin1Zh: "台湾", admin1En: "Taiwan" },
  { zh: "东京", en: "Tokyo", pinyin: "dongjing", lat: 35.6762, lon: 139.6503, countryZh: "日本", countryEn: "Japan", admin1Zh: "东京都", admin1En: "Tokyo" },
  { zh: "大阪", en: "Osaka", pinyin: "daban", lat: 34.6937, lon: 135.5023, countryZh: "日本", countryEn: "Japan", admin1Zh: "大阪府", admin1En: "Osaka" },
  { zh: "名古屋", en: "Nagoya", pinyin: "mingguwu", lat: 35.1815, lon: 136.9066, countryZh: "日本", countryEn: "Japan", admin1Zh: "爱知县", admin1En: "Aichi" },
  { zh: "札幌", en: "Sapporo", pinyin: "zhahuang", lat: 43.0618, lon: 141.3545, countryZh: "日本", countryEn: "Japan", admin1Zh: "北海道", admin1En: "Hokkaido" },
  { zh: "福冈", en: "Fukuoka", pinyin: "fugang", lat: 33.5904, lon: 130.4017, countryZh: "日本", countryEn: "Japan", admin1Zh: "福冈县", admin1En: "Fukuoka" },
  { zh: "首尔", en: "Seoul", pinyin: "shouer", lat: 37.5665, lon: 126.978, countryZh: "韩国", countryEn: "South Korea", admin1Zh: "首尔特别市", admin1En: "Seoul" },
  { zh: "釜山", en: "Busan", pinyin: "fushan", lat: 35.1796, lon: 129.0756, countryZh: "韩国", countryEn: "South Korea", admin1Zh: "釜山广域市", admin1En: "Busan" },
  { zh: "新加坡", en: "Singapore", pinyin: "xinjiapo", lat: 1.3521, lon: 103.8198, countryZh: "新加坡", countryEn: "Singapore", admin1Zh: "", admin1En: "" },
  { zh: "曼谷", en: "Bangkok", pinyin: "mangu", lat: 13.7563, lon: 100.5018, countryZh: "泰国", countryEn: "Thailand", admin1Zh: "", admin1En: "" },
  { zh: "清迈", en: "Chiang Mai", pinyin: "qingmai", lat: 18.7883, lon: 98.9853, countryZh: "泰国", countryEn: "Thailand", admin1Zh: "清迈府", admin1En: "Chiang Mai" },
  { zh: "吉隆坡", en: "Kuala Lumpur", pinyin: "jilongpo", lat: 3.139, lon: 101.6869, countryZh: "马来西亚", countryEn: "Malaysia", admin1Zh: "吉隆坡联邦直辖区", admin1En: "Kuala Lumpur" },
  { zh: "槟城", en: "Penang", pinyin: "bincheng", lat: 5.4141, lon: 100.3288, countryZh: "马来西亚", countryEn: "Malaysia", admin1Zh: "槟城州", admin1En: "Penang" },
  { zh: "雅加达", en: "Jakarta", pinyin: "yajiada", lat: -6.2088, lon: 106.8456, countryZh: "印度尼西亚", countryEn: "Indonesia", admin1Zh: "雅加达首都特区", admin1En: "Jakarta" },
  { zh: "马尼拉", en: "Manila", pinyin: "manila", lat: 14.5995, lon: 120.9842, countryZh: "菲律宾", countryEn: "Philippines", admin1Zh: "马尼拉首都地区", admin1En: "Metro Manila" },
  { zh: "河内", en: "Hanoi", pinyin: "henei", lat: 21.0285, lon: 105.8542, countryZh: "越南", countryEn: "Vietnam", admin1Zh: "", admin1En: "" },
  { zh: "胡志明市", en: "Ho Chi Minh City", pinyin: "huzhimingshi", lat: 10.8231, lon: 106.6297, countryZh: "越南", countryEn: "Vietnam", admin1Zh: "", admin1En: "" },
  { zh: "仰光", en: "Yangon", pinyin: "yangguang", lat: 16.8409, lon: 96.1735, countryZh: "缅甸", countryEn: "Myanmar", admin1Zh: "", admin1En: "" },
  { zh: "金边", en: "Phnom Penh", pinyin: "jinbian", lat: 11.5564, lon: 104.9282, countryZh: "柬埔寨", countryEn: "Cambodia", admin1Zh: "", admin1En: "" },
  { zh: "加尔各答", en: "Kolkata", pinyin: "jiaergedad", lat: 22.5726, lon: 88.3639, countryZh: "印度", countryEn: "India", admin1Zh: "西孟加拉邦", admin1En: "West Bengal" },
  { zh: "孟买", en: "Mumbai", pinyin: "mengmai", lat: 19.076, lon: 72.8777, countryZh: "印度", countryEn: "India", admin1Zh: "马哈拉施特拉邦", admin1En: "Maharashtra" },
  { zh: "新德里", en: "New Delhi", pinyin: "xindeli", lat: 28.6139, lon: 77.209, countryZh: "印度", countryEn: "India", admin1Zh: "德里", admin1En: "Delhi" },
  { zh: "迪拜", en: "Dubai", pinyin: "dibai", lat: 25.2048, lon: 55.2708, countryZh: "阿联酋", countryEn: "United Arab Emirates", admin1Zh: "迪拜酋长国", admin1En: "Dubai" },
  { zh: "伊斯坦布尔", en: "Istanbul", pinyin: "yisitanbuer", lat: 41.0082, lon: 28.9784, countryZh: "土耳其", countryEn: "Turkey", admin1Zh: "", admin1En: "" },
  { zh: "特拉维夫", en: "Tel Aviv", pinyin: "telaweifu", lat: 32.0853, lon: 34.7818, countryZh: "以色列", countryEn: "Israel", admin1Zh: "", admin1En: "" },
  { zh: "德黑兰", en: "Tehran", pinyin: "deheilan", lat: 35.6892, lon: 51.389, countryZh: "伊朗", countryEn: "Iran", admin1Zh: "", admin1En: "" },
  { zh: "利雅得", en: "Riyadh", pinyin: "liyade", lat: 24.7136, lon: 46.6753, countryZh: "沙特阿拉伯", countryEn: "Saudi Arabia", admin1Zh: "", admin1En: "" },
  { zh: "多哈", en: "Doha", pinyin: "duoha", lat: 25.2854, lon: 51.531, countryZh: "卡塔尔", countryEn: "Qatar", admin1Zh: "", admin1En: "" },
  { zh: "伦敦", en: "London", pinyin: "lundun", lat: 51.5074, lon: -0.1278, countryZh: "英国", countryEn: "United Kingdom", admin1Zh: "英格兰", admin1En: "England" },
  { zh: "曼彻斯特", en: "Manchester", pinyin: "manchesite", lat: 53.4808, lon: -2.2426, countryZh: "英国", countryEn: "United Kingdom", admin1Zh: "英格兰", admin1En: "England" },
  { zh: "爱丁堡", en: "Edinburgh", pinyin: "aidingbao", lat: 55.9533, lon: -3.1883, countryZh: "英国", countryEn: "United Kingdom", admin1Zh: "苏格兰", admin1En: "Scotland" },
  { zh: "都柏林", en: "Dublin", pinyin: "dublin", lat: 53.3498, lon: -6.2603, countryZh: "爱尔兰", countryEn: "Ireland", admin1Zh: "", admin1En: "" },
  { zh: "巴黎", en: "Paris", pinyin: "pali", lat: 48.8566, lon: 2.3522, countryZh: "法国", countryEn: "France", admin1Zh: "", admin1En: "" },
  { zh: "马赛", en: "Marseille", pinyin: "masai", lat: 43.2965, lon: 5.3698, countryZh: "法国", countryEn: "France", admin1Zh: "", admin1En: "" },
  { zh: "柏林", en: "Berlin", pinyin: "bolin", lat: 52.52, lon: 13.405, countryZh: "德国", countryEn: "Germany", admin1Zh: "", admin1En: "" },
  { zh: "慕尼黑", en: "Munich", pinyin: "munihei", lat: 48.1351, lon: 11.582, countryZh: "德国", countryEn: "Germany", admin1Zh: "巴伐利亚州", admin1En: "Bavaria" },
  { zh: "法兰克福", en: "Frankfurt", pinyin: "falankfu", lat: 50.1109, lon: 8.6821, countryZh: "德国", countryEn: "Germany", admin1Zh: "黑森州", admin1En: "Hesse" },
  { zh: "阿姆斯特丹", en: "Amsterdam", pinyin: "amusitedan", lat: 52.3676, lon: 4.9041, countryZh: "荷兰", countryEn: "Netherlands", admin1Zh: "北荷兰省", admin1En: "North Holland" },
  { zh: "布鲁塞尔", en: "Brussels", pinyin: "bulusaier", lat: 50.8503, lon: 4.3517, countryZh: "比利时", countryEn: "Belgium", admin1Zh: "", admin1En: "" },
  { zh: "卢森堡", en: "Luxembourg", pinyin: "lusenbao", lat: 49.6116, lon: 6.1319, countryZh: "卢森堡", countryEn: "Luxembourg", admin1Zh: "", admin1En: "" },
  { zh: "维也纳", en: "Vienna", pinyin: "weiyena", lat: 48.2082, lon: 16.3738, countryZh: "奥地利", countryEn: "Austria", admin1Zh: "", admin1En: "" },
  { zh: "苏黎世", en: "Zurich", pinyin: "sulishi", lat: 47.3769, lon: 8.5417, countryZh: "瑞士", countryEn: "Switzerland", admin1Zh: "苏黎世州", admin1En: "Zurich" },
  { zh: "日内瓦", en: "Geneva", pinyin: "rineiwa", lat: 46.2044, lon: 6.1432, countryZh: "瑞士", countryEn: "Switzerland", admin1Zh: "日内瓦州", admin1En: "Geneva" },
  { zh: "罗马", en: "Rome", pinyin: "luoma", lat: 41.9028, lon: 12.4964, countryZh: "意大利", countryEn: "Italy", admin1Zh: "", admin1En: "" },
  { zh: "米兰", en: "Milan", pinyin: "milan", lat: 45.4642, lon: 9.19, countryZh: "意大利", countryEn: "Italy", admin1Zh: "伦巴第大区", admin1En: "Lombardy" },
  { zh: "威尼斯", en: "Venice", pinyin: "weinisi", lat: 45.4408, lon: 12.3155, countryZh: "意大利", countryEn: "Italy", admin1Zh: "威尼托大区", admin1En: "Veneto" },
  { zh: "马德里", en: "Madrid", pinyin: "madeli", lat: 40.4168, lon: -3.7038, countryZh: "西班牙", countryEn: "Spain", admin1Zh: "", admin1En: "" },
  { zh: "巴塞罗那", en: "Barcelona", pinyin: "basaoluona", lat: 41.3851, lon: 2.1734, countryZh: "西班牙", countryEn: "Spain", admin1Zh: "加泰罗尼亚", admin1En: "Catalonia" },
  { zh: "里斯本", en: "Lisbon", pinyin: "lisiben", lat: 38.7223, lon: -9.1393, countryZh: "葡萄牙", countryEn: "Portugal", admin1Zh: "", admin1En: "" },
  { zh: "雅典", en: "Athens", pinyin: "yadian", lat: 37.9838, lon: 23.7275, countryZh: "希腊", countryEn: "Greece", admin1Zh: "", admin1En: "" },
  { zh: "哥本哈根", en: "Copenhagen", pinyin: "gebenhagen", lat: 55.6761, lon: 12.5683, countryZh: "丹麦", countryEn: "Denmark", admin1Zh: "", admin1En: "" },
  { zh: "斯德哥尔摩", en: "Stockholm", pinyin: "sidegeermo", lat: 59.3293, lon: 18.0686, countryZh: "瑞典", countryEn: "Sweden", admin1Zh: "", admin1En: "" },
  { zh: "奥斯陆", en: "Oslo", pinyin: "aosilu", lat: 59.9139, lon: 10.7522, countryZh: "挪威", countryEn: "Norway", admin1Zh: "", admin1En: "" },
  { zh: "赫尔辛基", en: "Helsinki", pinyin: "heerxinji", lat: 60.1699, lon: 24.9384, countryZh: "芬兰", countryEn: "Finland", admin1Zh: "", admin1En: "" },
  { zh: "雷克雅未克", en: "Reykjavik", pinyin: "leiyaweike", lat: 64.1466, lon: -21.9426, countryZh: "冰岛", countryEn: "Iceland", admin1Zh: "", admin1En: "" },
  { zh: "布拉格", en: "Prague", pinyin: "ulage", lat: 50.0755, lon: 14.4378, countryZh: "捷克", countryEn: "Czech Republic", admin1Zh: "", admin1En: "" },
  { zh: "布达佩斯", en: "Budapest", pinyin: "budapeisi", lat: 47.4979, lon: 19.0402, countryZh: "匈牙利", countryEn: "Hungary", admin1Zh: "", admin1En: "" },
  { zh: "华沙", en: "Warsaw", pinyin: "huasha", lat: 52.2297, lon: 21.0122, countryZh: "波兰", countryEn: "Poland", admin1Zh: "", admin1En: "" },
  { zh: "基辅", en: "Kyiv", pinyin: "jifu", lat: 50.4501, lon: 30.5234, countryZh: "乌克兰", countryEn: "Ukraine", admin1Zh: "", admin1En: "" },
  { zh: "莫斯科", en: "Moscow", pinyin: "mosike", lat: 55.7558, lon: 37.6173, countryZh: "俄罗斯", countryEn: "Russia", admin1Zh: "", admin1En: "" },
  { zh: "圣彼得堡", en: "Saint Petersburg", pinyin: "shengbidebao", lat: 59.9311, lon: 30.3609, countryZh: "俄罗斯", countryEn: "Russia", admin1Zh: "", admin1En: "" },
  { zh: "纽约", en: "New York", pinyin: "niuyue", lat: 40.7128, lon: -74.006, countryZh: "美国", countryEn: "United States", admin1Zh: "纽约州", admin1En: "New York" },
  { zh: "洛杉矶", en: "Los Angeles", pinyin: "luoshanji", lat: 34.0522, lon: -118.2437, countryZh: "美国", countryEn: "United States", admin1Zh: "加利福尼亚州", admin1En: "California" },
  { zh: "旧金山", en: "San Francisco", pinyin: "jiujinshan", lat: 37.7749, lon: -122.4194, countryZh: "美国", countryEn: "United States", admin1Zh: "加利福尼亚州", admin1En: "California" },
  { zh: "西雅图", en: "Seattle", pinyin: "xiyatu", lat: 47.6062, lon: -122.3321, countryZh: "美国", countryEn: "United States", admin1Zh: "华盛顿州", admin1En: "Washington" },
  { zh: "芝加哥", en: "Chicago", pinyin: "zhijiage", lat: 41.8781, lon: -87.6298, countryZh: "美国", countryEn: "United States", admin1Zh: "伊利诺伊州", admin1En: "Illinois" },
  { zh: "波士顿", en: "Boston", pinyin: "boshidun", lat: 42.3601, lon: -71.0589, countryZh: "美国", countryEn: "United States", admin1Zh: "马萨诸塞州", admin1En: "Massachusetts" },
  { zh: "华盛顿", en: "Washington D.C.", pinyin: "huashengdun", lat: 38.9072, lon: -77.0369, countryZh: "美国", countryEn: "United States", admin1Zh: "哥伦比亚特区", admin1En: "District of Columbia" },
  { zh: "迈阿密", en: "Miami", pinyin: "maiami", lat: 25.7617, lon: -80.1918, countryZh: "美国", countryEn: "United States", admin1Zh: "佛罗里达州", admin1En: "Florida" },
  { zh: "拉斯维加斯", en: "Las Vegas", pinyin: "lasiweijiasi", lat: 36.1699, lon: -115.1398, countryZh: "美国", countryEn: "United States", admin1Zh: "内华达州", admin1En: "Nevada" },
  { zh: "丹佛", en: "Denver", pinyin: "danfo", lat: 39.7392, lon: -104.9903, countryZh: "美国", countryEn: "United States", admin1Zh: "科罗拉多州", admin1En: "Colorado" },
  { zh: "休斯顿", en: "Houston", pinyin: "xiusidun", lat: 29.7604, lon: -95.3698, countryZh: "美国", countryEn: "United States", admin1Zh: "得克萨斯州", admin1En: "Texas" },
  { zh: "亚特兰大", en: "Atlanta", pinyin: "yatedalanda", lat: 33.749, lon: -84.388, countryZh: "美国", countryEn: "United States", admin1Zh: "佐治亚州", admin1En: "Georgia" },
  { zh: "多伦多", en: "Toronto", pinyin: "duolunduo", lat: 43.6532, lon: -79.3832, countryZh: "加拿大", countryEn: "Canada", admin1Zh: "安大略省", admin1En: "Ontario" },
  { zh: "温哥华", en: "Vancouver", pinyin: "wengehua", lat: 49.2827, lon: -123.1207, countryZh: "加拿大", countryEn: "Canada", admin1Zh: "不列颠哥伦比亚省", admin1En: "British Columbia" },
  { zh: "蒙特利尔", en: "Montreal", pinyin: "engtelier", lat: 45.5017, lon: -73.5673, countryZh: "加拿大", countryEn: "Canada", admin1Zh: "魁北克省", admin1En: "Quebec" },
  { zh: "墨西哥城", en: "Mexico City", pinyin: "moxigecheng", lat: 19.4326, lon: -99.1332, countryZh: "墨西哥", countryEn: "Mexico", admin1Zh: "", admin1En: "" },
  { zh: "哈瓦那", en: "Havana", pinyin: "hawana", lat: 23.1136, lon: -82.3666, countryZh: "古巴", countryEn: "Cuba", admin1Zh: "", admin1En: "" },
  { zh: "圣保罗", en: "Sao Paulo", pinyin: "shengbaoluo", lat: -23.5505, lon: -46.6333, countryZh: "巴西", countryEn: "Brazil", admin1Zh: "圣保罗州", admin1En: "Sao Paulo" },
  { zh: "里约热内卢", en: "Rio de Janeiro", pinyin: "liyuereneilu", lat: -22.9068, lon: -43.1729, countryZh: "巴西", countryEn: "Brazil", admin1Zh: "里约热内卢州", admin1En: "Rio de Janeiro" },
  { zh: "布宜诺斯艾利斯", en: "Buenos Aires", pinyin: "buynuosiailisi", lat: -34.6037, lon: -58.3816, countryZh: "阿根廷", countryEn: "Argentina", admin1Zh: "", admin1En: "" },
  { zh: "圣地亚哥", en: "Santiago", pinyin: "shengdiyage", lat: -33.4489, lon: -70.6693, countryZh: "智利", countryEn: "Chile", admin1Zh: "", admin1En: "" },
  { zh: "利马", en: "Lima", pinyin: "lima", lat: -12.0464, lon: -77.0428, countryZh: "秘鲁", countryEn: "Peru", admin1Zh: "", admin1En: "" },
  { zh: "波哥大", en: "Bogota", pinyin: "bogeda", lat: 4.711, lon: -74.0721, countryZh: "哥伦比亚", countryEn: "Colombia", admin1Zh: "", admin1En: "" },
  { zh: "悉尼", en: "Sydney", pinyin: "xini", lat: -33.8688, lon: 151.2093, countryZh: "澳大利亚", countryEn: "Australia", admin1Zh: "新南威尔士州", admin1En: "New South Wales" },
  { zh: "墨尔本", en: "Melbourne", pinyin: "moerben", lat: -37.8136, lon: 144.9631, countryZh: "澳大利亚", countryEn: "Australia", admin1Zh: "维多利亚州", admin1En: "Victoria" },
  { zh: "布里斯班", en: "Brisbane", pinyin: "bulisiban", lat: -27.4698, lon: 153.0251, countryZh: "澳大利亚", countryEn: "Australia", admin1Zh: "昆士兰州", admin1En: "Queensland" },
  { zh: "珀斯", en: "Perth", pinyin: "posi", lat: -31.9505, lon: 115.8605, countryZh: "澳大利亚", countryEn: "Australia", admin1Zh: "西澳大利亚州", admin1En: "Western Australia" },
  { zh: "阿德莱德", en: "Adelaide", pinyin: "adelaide", lat: -34.9285, lon: 138.6007, countryZh: "澳大利亚", countryEn: "Australia", admin1Zh: "南澳大利亚州", admin1En: "South Australia" },
  { zh: "奥克兰", en: "Auckland", pinyin: "aokelan", lat: -36.8485, lon: 174.7633, countryZh: "新西兰", countryEn: "New Zealand", admin1Zh: "奥克兰大区", admin1En: "Auckland" },
  { zh: "惠灵顿", en: "Wellington", pinyin: "huilingdun", lat: -41.2865, lon: 174.7762, countryZh: "新西兰", countryEn: "New Zealand", admin1Zh: "惠灵顿大区", admin1En: "Wellington" },
  { zh: "开罗", en: "Cairo", pinyin: "kailuo", lat: 30.0444, lon: 31.2357, countryZh: "埃及", countryEn: "Egypt", admin1Zh: "", admin1En: "" },
  { zh: "拉各斯", en: "Lagos", pinyin: "lagesi", lat: 6.5244, lon: 3.3792, countryZh: "尼日利亚", countryEn: "Nigeria", admin1Zh: "", admin1En: "" },
  { zh: "内罗毕", en: "Nairobi", pinyin: "neiluobi", lat: -1.2921, lon: 36.8219, countryZh: "肯尼亚", countryEn: "Kenya", admin1Zh: "", admin1En: "" },
  { zh: "约翰内斯堡", en: "Johannesburg", pinyin: "yuehanneisibao", lat: -26.2041, lon: 28.0473, countryZh: "南非", countryEn: "South Africa", admin1Zh: "豪登省", admin1En: "Gauteng" },
  { zh: "开普敦", en: "Cape Town", pinyin: "kaipudun", lat: -33.9249, lon: 18.4241, countryZh: "南非", countryEn: "South Africa", admin1Zh: "西开普省", admin1En: "Western Cape" },
  { zh: "卡萨布兰卡", en: "Casablanca", pinyin: "kasabulanaka", lat: 33.5731, lon: -7.5898, countryZh: "摩洛哥", countryEn: "Morocco", admin1Zh: "", admin1En: "" },
  { zh: "亚的斯亚贝巴", en: "Addis Ababa", pinyin: "yadiyabeiba", lat: 9.032, lon: 38.7426, countryZh: "埃塞俄比亚", countryEn: "Ethiopia", admin1Zh: "", admin1En: "" }
]

// ============================================================
// 工具函数
// ============================================================

/**
 * HTTP GET 请求
 * @param {string} url
 * @param {object} [options] { timeoutMs }
 * @returns {Promise<object>}
 */
function httpGet (url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (err) {
          reject(new Error('响应解析失败'))
        }
      })
    })
    req.on('error', reject)
    if (options.timeoutMs) {
      req.setTimeout(options.timeoutMs, () => {
        req.destroy(new Error('请求超时'))
      })
    }
  })
}

/**
 * 判断是否为中文语言
 * @param {string} language
 * @returns {boolean}
 */
function isChineseLanguage (language) {
  return !!language && language.toLowerCase().startsWith('zh')
}

/**
 * 规范化搜索文本：NFKD 分解 + 移除变音标记 + 仅保留字母数字 + 转小写
 * @param {string} value
 * @returns {string}
 */
function normalizeSearchText (value) {
  if (!value || value.trim() === '') return ''
  // NFKD 分解，分离变音标记
  const decomposed = value.normalize('NFKD')
  let result = ''
  for (const ch of decomposed) {
    // 跳过组合变音标记（U+0300-U+036F）
    const code = ch.codePointAt(0)
    if (code >= 0x0300 && code <= 0x036F) continue
    // 仅保留字母和数字
    if (/[a-zA-Z0-9]/.test(ch)) {
      result += ch.toLowerCase()
    }
  }
  return result.normalize('NFC')
}

/**
 * 判断是否为有效坐标
 * @param {number} latitude
 * @param {number} longitude
 * @returns {boolean}
 */
function isValidCoordinate (latitude, longitude) {
  return Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 &&
    longitude >= -180 && longitude <= 180
}

/**
 * 计算两点间大圆距离（haversine 公式），单位 km
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number}
 */
function haversineDistance (lat1, lon1, lat2, lon2) {
  const R = 6371 // 地球半径 km
  const toRad = (d) => d * Math.PI / 180.0
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * 拼音首字母匹配：如 "hz" 匹配 "hangzhou"，"bj" 匹配 "beijing"
 * @param {string} pinyin
 * @param {string} initials
 * @returns {boolean}
 */
function matchesPinyinInitials (pinyin, initials) {
  if (!pinyin || initials.length > pinyin.length) return false
  // 前缀匹配
  if (pinyin.toLowerCase().startsWith(initials.toLowerCase())) return true
  // 音节首字母匹配：如 "hz" 匹配 "hangzhou"（h + z）
  if (initials.length >= 2 && initials.length <= 4) {
    const lowerPinyin = pinyin.toLowerCase()
    const lowerInitials = initials.toLowerCase()
    if (lowerPinyin[0] !== lowerInitials[0]) return false
    // 2 字母首字母：检查后续是否存在第二个字母
    if (lowerInitials.length === 2) {
      for (let j = 1; j < lowerPinyin.length; j++) {
        if (lowerPinyin[j] === lowerInitials[1]) return true
      }
    }
  }
  return false
}

/**
 * 计算本地城市搜索相关度
 * 完全匹配 500 > 拼音完全匹配 450 > 前缀匹配 350 > 包含 250 > 其他 100
 * @param {object} city PredefinedCity
 * @param {string} normalizedQuery
 * @returns {number}
 */
function getSearchRelevance (city, normalizedQuery) {
  const zh = normalizeSearchText(city.zh)
  const en = normalizeSearchText(city.en)
  const pinyin = normalizeSearchText(city.pinyin)
  if (zh === normalizedQuery || en === normalizedQuery) return 500
  if (pinyin === normalizedQuery) return 450
  if (zh.startsWith(normalizedQuery) || en.startsWith(normalizedQuery) || pinyin.startsWith(normalizedQuery)) return 350
  if (zh.includes(normalizedQuery) || en.includes(normalizedQuery) || pinyin.includes(normalizedQuery)) return 250
  return 100
}

/**
 * 计算搜索结果相关度（API 结果）
 * @param {object} result WeatherCitySearchResult
 * @param {string} query
 * @returns {number}
 */
function getResultRelevance (result, query) {
  const normalizedQuery = normalizeSearchText(query)
  const name = normalizeSearchText(result.name)
  const displayName = normalizeSearchText(result.displayName)
  if (name === normalizedQuery) return 500
  if (name.startsWith(normalizedQuery)) return 350
  if (name.includes(normalizedQuery)) return 250
  return displayName.includes(normalizedQuery) ? 100 : 0
}

/**
 * 构建显示名称（name, admin1, country 用逗号连接）
 * @param {string} name
 * @param {string} admin1
 * @param {string} country
 * @returns {string}
 */
function buildDisplayNameFromParts (name, admin1, country) {
  const parts = [name]
  if (admin1 && admin1 !== name) parts.push(admin1)
  if (country) parts.push(country)
  return parts.join(', ')
}

/**
 * 将预定义城市转换为搜索结果
 * @param {object} c PredefinedCity
 * @param {boolean} isEn 是否英文
 * @returns {object} WeatherCitySearchResult
 */
function toSearchResult (c, isEn) {
  const name = isEn ? c.en : c.zh
  const admin1 = isEn ? c.admin1En : c.admin1Zh
  const country = isEn ? c.countryEn : c.countryZh
  return {
    name,
    displayName: buildDisplayNameFromParts(name, admin1, country),
    latitude: c.lat,
    longitude: c.lon,
    country,
    admin1
  }
}

// ============================================================
// ============================================================

/**
 * 搜索本地预定义城市（即时，无网络）
 * 支持中文/英文/拼音/拼音首字母/国家/行政区匹配
 * @param {string} query
 * @param {boolean} isEn
 * @returns {Array}
 */
function searchLocalCities (query, isEn) {
  const lower = query.toLowerCase()
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return []
  // 判断是否为拼音首字母查询（纯小写字母且长度 >= 2）
  const isPinyinInitials = lower.length >= 2 && /^[a-z]+$/.test(lower)

  return PREDEFINED_CITIES
    .filter(c => {
      // 在所有名称变体中搜索
      return normalizeSearchText(c.zh).includes(normalizedQuery) ||
        normalizeSearchText(c.en).includes(normalizedQuery) ||
        normalizeSearchText(c.pinyin).includes(normalizedQuery) ||
        normalizeSearchText(c.countryZh).includes(normalizedQuery) ||
        normalizeSearchText(c.countryEn).includes(normalizedQuery) ||
        normalizeSearchText(c.admin1Zh).includes(normalizedQuery) ||
        normalizeSearchText(c.admin1En).includes(normalizedQuery) ||
        (isPinyinInitials && matchesPinyinInitials(c.pinyin, lower))
    })
    .sort((a, b) => getSearchRelevance(b, normalizedQuery) - getSearchRelevance(a, normalizedQuery))
    .slice(0, 8)
    .map(c => toSearchResult(c, isEn))
}

/**
 * 通过 Open-Meteo 地理编码 API 搜索城市
 * @param {string} query
 * @param {string} language
 * @returns {Promise<Array>}
 */
async function searchCityViaApi (query, language) {
  const lang = isChineseLanguage(language) ? 'zh' : 'en'
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=10&language=${lang}&format=json`
  const data = await httpGet(url, { timeoutMs: 5000 })
  if (!data.results || !Array.isArray(data.results)) return []
  return data.results.map(item => ({
    name: item.name || '',
    displayName: buildDisplayNameFromParts(item.name || '', item.admin1 || '', item.country || ''),
    latitude: item.latitude,
    longitude: item.longitude,
    country: item.country || '',
    admin1: item.admin1 || ''
  }))
}

/**
 * 统一城市搜索：合并本地预定义列表 + Open-Meteo API 结果
 * 本地结果优先（有完整 zh/en 名称），API 结果补充覆盖
 * 按相关度 > 是否本地 > 距离 > 序号排序，取前 10 条
 * @param {string} query
 * @param {string} language
 * @param {number} [userLat] 用户纬度（用于距离排序）
 * @param {number} [userLon] 用户经度
 * @returns {Promise<Array>}
 */
async function searchCities (query, language = 'zh', userLat = null, userLon = null) {
  if (!query || query.trim() === '') return []
  query = query.trim()
  if (!normalizeSearchText(query)) return []

  // 允许单个 CJK 字符搜索（如 "京" → 北京），拉丁查询至少 2 字符
  const hasCjk = /[\u4e00-\u9fff]/.test(query)
  if (!hasCjk && query.length < 2) return []

  const isEn = !isChineseLanguage(language)

  // 1. 搜索本地预定义城市（即时，无网络）
  const localResults = searchLocalCities(query, isEn)

  // 2. 通过 Open-Meteo API 搜索（并行，带超时）
  let apiResults = []
  try {
    apiResults = await searchCityViaApi(query, language)
  } catch (err) {
    console.warn('[WeatherService] Open-Meteo 城市搜索失败:', err.message)
  }

  // 3. 合并 + 去重（按坐标 2 位小数去重）
  const merged = []
  const seen = new Set()
  let sequence = 0

  // 本地结果优先
  for (const r of localResults) {
    const key = `${r.latitude.toFixed(2)},${r.longitude.toFixed(2)}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push({ result: r, relevance: getLocalResultRelevance(r, query), isLocal: true, sequence: sequence++ })
  }

  // API 结果补充
  for (const item of apiResults) {
    if (!isValidCoordinate(item.latitude, item.longitude)) continue
    const key = `${item.latitude.toFixed(2)},${item.longitude.toFixed(2)}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push({ result: item, relevance: getResultRelevance(item, query), isLocal: false, sequence: sequence++ })
  }

  // 排序：相关度 > 是否本地 > 距离 > 序号
  merged.sort((a, b) => {
    if (b.relevance !== a.relevance) return b.relevance - a.relevance
    if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1
    const distA = (userLat != null && userLon != null)
      ? haversineDistance(userLat, userLon, a.result.latitude, a.result.longitude)
      : Number.MAX_VALUE
    const distB = (userLat != null && userLon != null)
      ? haversineDistance(userLat, userLon, b.result.latitude, b.result.longitude)
      : Number.MAX_VALUE
    if (distA !== distB) return distA - distB
    return a.sequence - b.sequence
  })

  return merged.slice(0, 10).map(c => c.result)
}

/**
 * 计算本地结果的相关度（查找对应的预定义城市）
 * @param {object} result
 * @param {string} query
 * @returns {number}
 */
function getLocalResultRelevance (result, query) {
  const city = PREDEFINED_CITIES.find(c =>
    Math.abs(c.lat - result.latitude) < 0.0001 &&
    Math.abs(c.lon - result.longitude) < 0.0001)
  return city
    ? getSearchRelevance(city, normalizeSearchText(query))
    : getResultRelevance(result, query)
}

/**
 * 获取附近热门城市（按距离排序）
 * @param {number} [lat] 用户纬度
 * @param {number} [lon] 用户经度
 * @param {string} language
 * @param {number} maxCount
 * @returns {Array}
 */
function getNearbyPopularCities (lat = null, lon = null, language = 'zh', maxCount = 8) {
  const isEn = !isChineseLanguage(language)
  let cities = [...PREDEFINED_CITIES]
  if (lat != null && lon != null) {
    cities.sort((a, b) =>
      haversineDistance(lat, lon, a.lat, a.lon) -
      haversineDistance(lat, lon, b.lat, b.lon))
  }
  return cities.slice(0, maxCount).map(c => toSearchResult(c, isEn))
}

/**
 * 获取全球热门城市（无位置时的回退列表）
 * 选取全球代表性城市的索引分布
 * @param {string} language
 * @param {number} maxCount
 * @returns {Array}
 */
function getGlobalPopularCities (language = 'zh', maxCount = 8) {
  const isEn = !isChineseLanguage(language)
  const indices = [0, 1, 2, 3, 4, 39, 53, 59, 78, 99, 113]
  return indices
    .filter(i => i < PREDEFINED_CITIES.length)
    .slice(0, maxCount)
    .map(i => toSearchResult(PREDEFINED_CITIES[i], isEn))
}

/**
 * 反向地理编码：坐标 → 最近城市名
 * @param {number} lat 纬度
 * @param {number} lon 经度
 * @param {string} language
 * @param {number} maxDistanceKm 最大匹配距离
 * @returns {string|null}
 */
function getNearestCityName (lat, lon, language = 'zh', maxDistanceKm = 80) {
  const useChinese = isChineseLanguage(language)
  let best = null
  let bestDist = Number.MAX_VALUE
  for (const c of PREDEFINED_CITIES) {
    const d = haversineDistance(lat, lon, c.lat, c.lon)
    if (d < bestDist) {
      bestDist = d
      best = c
    }
  }
  if (!best || bestDist > maxDistanceKm) return null
  return useChinese ? best.zh : best.en
}

// ============================================================
// 解析天气数据
// ============================================================

/**
 * 解析天气数据（MSN Weather 格式）
 * @param {object} data
 * @returns {object}
 */
function parseWeatherData (data) {
  if (!data || !data.current) {
    throw new Error('无效的天气数据')
  }

  const current = data.current
  return {
    temperature: current.tempC || current.tempF,
    feelsLike: current.featC || current.featF,
    condition: current.condition?.text || 'Unknown',
    conditionCode: current.condition?.code,
    humidity: current.humid || 0,
    windSpeed: current.windSpdKmph || current.windSpdMph,
    pressure: current.pressure || 0,
    visibility: current.visibilityKm || current.visibilityMiles,
    uvIndex: current.uvIndex || 0,
    sunrise: current.sunrise,
    sunset: current.sunset,
    lastUpdated: new Date().toISOString()
  }
}

/**
 * 解析小时预报
 * @param {object} data
 * @returns {Array}
 */
function parseHourlyForecast (data) {
  if (!data.hourly || !Array.isArray(data.hourly)) return []

  return data.hourly.map(hour => ({
    time: hour.time,
    temperature: hour.tempC || hour.tempF,
    condition: hour.condition?.text || 'Unknown',
    conditionCode: hour.condition?.code,
    humidity: hour.humid,
    windSpeed: hour.windSpdKmph || hour.windSpdMph
  }))
}

/**
 * 解析日预报
 * @param {object} data
 * @returns {Array}
 */
function parseDailyForecast (data) {
  if (!data.daily || !Array.isArray(data.daily)) return []

  return data.daily.slice(0, 7).map(day => ({
    date: day.date,
    dateFormatted: new Date(day.date).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
    dayName: new Date(day.date).toLocaleDateString('zh-CN', { weekday: 'short' }),
    high: day.maxtempC || day.maxtempF,
    low: day.mintempC || day.mintempF,
    condition: day.condition?.text || 'Unknown',
    conditionCode: day.condition?.code,
    sunrise: day.sunrise,
    sunset: day.sunset
  }))
}

// ============================================================
// IPC 处理器
// ============================================================

/**
 * 注册天气服务相关的 IPC 通道
 */
function registerWeatherChannels () {
  // 获取天气数据
  ipcMain.handle('weather:get-weather', async (event, data) => {
    try {
      const { city, units = 'metric' } = data || {}
      if (!city) {
        return { error: { code: 'INVALID_ARGS', message: '城市名称不能为空' } }
      }

      const cacheKey = `${city.toLowerCase()}_${units}`
      const cached = await getCachedWeather(cacheKey)

      if (cached) {
        return { ...cached, fromCache: true }
      }

      // 获取城市坐标
      const cityInfo = await findCity(city)
      if (!cityInfo) {
        return { error: { code: 'NOT_FOUND', message: `未找到城市: ${city}` } }
      }

      // 获取天气数据
      const weather = await fetchWeatherData(cityInfo, units)

      // 缓存结果
      await cacheWeather(cacheKey, weather)

      return { ...weather, fromCache: false }
    } catch (error) {
      console.error('[WeatherService] weather:get-weather 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 支持中文/英文/拼音/拼音首字母，合并本地 + Open-Meteo API 结果
  ipcMain.handle('weather:search-cities', async (event, data) => {
    try {
      const { query, language = 'zh', userLat, userLon } = data || {}
      if (!query || query.trim() === '') {
        return { cities: [] }
      }
      const cities = await searchCities(query, language, userLat, userLon)
      return { cities }
    } catch (error) {
      console.error('[WeatherService] weather:search-cities 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 获取附近热门城市
  ipcMain.handle('weather:nearby-cities', async (event, data) => {
    try {
      const { lat, lon, language = 'zh', maxCount = 8 } = data || {}
      const cities = getNearbyPopularCities(lat, lon, language, maxCount)
      return { cities }
    } catch (error) {
      console.error('[WeatherService] weather:nearby-cities 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 获取全球热门城市
  ipcMain.handle('weather:popular-cities', async (event, data) => {
    try {
      const { language = 'zh', maxCount = 8 } = data || {}
      const cities = getGlobalPopularCities(language, maxCount)
      return { cities }
    } catch (error) {
      console.error('[WeatherService] weather:popular-cities 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 反向地理编码：坐标 → 最近城市名
  ipcMain.handle('weather:reverse-geocode', async (event, data) => {
    try {
      const { lat, lon, language = 'zh', maxDistanceKm = 80 } = data || {}
      if (lat == null || lon == null) {
        return { error: { code: 'INVALID_ARGS', message: '坐标不能为空' } }
      }
      const cityName = getNearestCityName(lat, lon, language, maxDistanceKm)
      return { cityName }
    } catch (error) {
      console.error('[WeatherService] weather:reverse-geocode 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 清除天气缓存
  ipcMain.handle('weather:clear-cache', async (event, data) => {
    try {
      await fs.rm(CACHE_DIR, { recursive: true, force: true })
      await fs.mkdir(CACHE_DIR, { recursive: true })
      return { success: true }
    } catch (error) {
      console.error('[WeatherService] weather:clear-cache 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })
}

// ============================================================
// 城市查找（用于天气数据获取）
// ============================================================

/**
 * 查找城市信息（用于天气数据获取）
 * 优先搜索预定义城市列表，回退到 Open-Meteo 地理编码
 * @param {string} cityName
 * @returns {Promise<object|null>}
 */
async function findCity (cityName) {
  // 1. 在预定义城市列表中精确匹配（中文名/英文名/拼音）
  const lowerName = cityName.toLowerCase()
  const match = PREDEFINED_CITIES.find(c =>
    c.zh === cityName ||
    c.en.toLowerCase() === lowerName ||
    c.pinyin === lowerName
  )
  if (match) {
    return {
      name: match.en,
      country: match.countryEn,
      latitude: match.lat,
      longitude: match.lon,
      woeid: null
    }
  }

  // 2. 回退到旧版 CITIES_DATA（向后兼容）
  const legacyMatch = CITIES_DATA.find(city =>
    city.name.toLowerCase() === lowerName
  )
  if (legacyMatch) {
    return legacyMatch
  }

  // 3. 尝试通过 Open-Meteo 反向地理编码
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=zh&format=json`
    const data = await httpGet(url)
    if (data.results && data.results.length > 0) {
      const result = data.results[0]
      return {
        name: result.name,
        country: result.country,
        latitude: result.latitude,
        longitude: result.longitude,
        woeid: null
      }
    }
  } catch (err) {
    console.warn('[WeatherService] Open-Meteo 地理编码失败:', err.message)
  }

  return null
}

// ============================================================
// 天气数据获取
// ============================================================

/**
 * 获取天气数据（使用 MSN Weather API）
 * @param {object} cityInfo
 * @param {string} units
 * @returns {Promise<object>}
 */
async function fetchWeatherData (cityInfo, units) {
  // 优先使用 MSN Weather
  try {
    const woeid = cityInfo.woeid
    if (woeid) {
      const data = await fetchFromMsnWeather(woeid, units)
      if (data) {
        return data
      }
    }
  } catch (err) {
    console.warn('[WeatherService] MSN Weather 失败，回退到 Open-Meteo:', err.message)
  }

  // 回退到 Open-Meteo
  return fetchFromOpenMeteo(cityInfo, units)
}

/**
 * 从 MSN Weather 获取数据
 * @param {number} woeid
 * @param {string} units
 * @returns {Promise<object|null>}
 */
async function fetchFromMsnWeather (woeid, units) {
  // MSN Weather API 需要特定的请求头和格式
  // 这里使用一个公共的代理方案
  const url = `https://www.microsoft.com/en-us/store/services/weather/${woeid}`
  // 实际实现需要处理 Microsoft 的认证和 API 格式
  // 这里简化处理，返回 null 表示不可用
  return null
}

/**
 * 从 Open-Meteo 获取数据
 * @param {object} cityInfo
 * @param {string} units
 * @returns {Promise<object>}
 */
async function fetchFromOpenMeteo (cityInfo, units) {
  const { latitude, longitude } = cityInfo
  const tempUnit = units === 'imperial' ? '&temperature_unit=fahrenheit' : ''
  const windUnit = units === 'imperial' ? '&wind_speed_unit=mph' : ''

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}${tempUnit}${windUnit}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,precipitation,rain,showers,snowfall,cloud_cover,pressure_msl,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m&hourly=temperature_2m,relative_humidity_2m,dew_point_2m,apparent_temperature,precipitation_probability,precipitation,rain,showers,snowfall,weather_code,cloud_cover,pressure_msl,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,sunrise,sunset,uv_index_max,precipitation_sum,rain_sum,showers_sum,snowfall_sum,precipitation_hours,precipitation_probability_max&timezone=auto`

  const data = await httpGet(url)

  // 解析 Open-Meteo 响应
  const current = data.current
  const daily = data.daily

  // 天气代码映射
  const weatherCodeMap = {
    0: 'clear', 1: 'partly-cloudy', 2: 'partly-cloudy', 3: 'cloudy',
    45: 'fog', 48: 'fog',
    51: 'rain', 53: 'rain', 55: 'rain',
    61: 'rain', 63: 'rain', 65: 'rain',
    71: 'snow', 73: 'snow', 75: 'snow',
    80: 'rain', 81: 'rain', 82: 'rain',
    95: 'thunder', 96: 'thunder', 99: 'thunder'
  }

  const currentCondition = weatherCodeMap[current.weather_code] || 'clear'

  // 构建预报数据
  const hourlyForecast = []
  const now = new Date()
  for (let i = 0; i < 24; i++) {
    const hourTime = new Date(now.getTime() + i * 60 * 60 * 1000)
    hourlyForecast.push({
      time: hourTime.toISOString(),
      temperature: current.temperature_2m,
      condition: 'partly-cloudy'
    })
  }

  const dailyForecast = []
  for (let i = 0; i < daily.time.length; i++) {
    const date = new Date(daily.time[i])
    dailyForecast.push({
      date: date.toISOString().split('T')[0],
      high: daily.temperature_2m_max[i],
      low: daily.temperature_2m_min[i],
      condition: weatherCodeMap[daily.weather_code[i]] || 'clear'
    })
  }

  return {
    current: {
      temperature: current.temperature_2m,
      feelsLike: current.apparent_temperature,
      condition: currentCondition,
      humidity: current.relative_humidity_2m,
      windSpeed: current.wind_speed_10m,
      pressure: current.pressure_msl,
      uvIndex: daily.uv_index_max?.[0] || 0,
      sunrise: daily.sunrise?.[0],
      sunset: daily.sunset?.[0]
    },
    hourly: hourlyForecast,
    daily: dailyForecast
  }
}

// ============================================================
// 缓存管理
// ============================================================

/**
 * 获取缓存的天气数据
 * @param {string} key
 * @returns {Promise<object|null>}
 */
async function getCachedWeather (key) {
  try {
    await fs.access(CACHE_DIR)
    const cacheFile = path.join(CACHE_DIR, `${key}.json`)
    const content = await fs.readFile(cacheFile, 'utf8')
    const cached = JSON.parse(content)

    // 检查是否过期
    if (Date.now() - cached.timestamp > CACHE_EXPIRY) {
      await fs.unlink(cacheFile)
      return null
    }

    return cached.data
  } catch (err) {
    return null
  }
}

/**
 * 缓存天气数据
 * @param {string} key
 * @param {object} data
 */
async function cacheWeather (key, data) {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true })
    const cacheFile = path.join(CACHE_DIR, `${key}.json`)
    await fs.writeFile(cacheFile, JSON.stringify({
      timestamp: Date.now(),
      data
    }))
  } catch (err) {
    console.warn('[WeatherService] 缓存失败:', err.message)
  }
}

// ============================================================
// 导出
// ============================================================

module.exports = {
  registerWeatherChannels,
  parseWeatherData,
  parseHourlyForecast,
  parseDailyForecast,
  searchCities,
  searchLocalCities,
  getNearbyPopularCities,
  getGlobalPopularCities,
  getNearestCityName,
  // 工具函数
  normalizeSearchText,
  haversineDistance,
  isChineseLanguage,
  isValidCoordinate
}
