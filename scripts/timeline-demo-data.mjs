import { applyEventOperation, emptyEventDocument, normalizeEventDocument } from '../src/event.js'

const TITLE = '星港回声档案｜复杂时间线演示'

const TIMELINES = Object.freeze({
  harbor: '港城现实｜原点2036-06-21 18:00:00（秒）',
  cosmic: '宇宙史与毫秒信号同轴（秒）',
  ship: '远航者七号｜舰载计时（秒）',
  tide: '镜海异世界｜汐刻',
  loop: '回声室｜循环轮次',
  point: '单坐标轴｜唯一坐标42',
})

const range = (timeline, start, end, label, coordinateUnit) => ({
  state: 'normalized',
  timeline,
  start,
  end,
  label,
  coordinateUnit,
})

const harbor = (start, end, label) => range(TIMELINES.harbor, start, end, label, '秒（相对原点）')
const cosmic = (start, end, label) => range(TIMELINES.cosmic, start, end, label, '秒')
const ship = (start, end, label) => range(TIMELINES.ship, start, end, label, '舰载秒')
const tide = (start, end, label) => range(TIMELINES.tide, start, end, label, '汐刻')
const loop = (start, end, label) => range(TIMELINES.loop, start, end, label, '轮次刻度')
const point = (end, label) => range(TIMELINES.point, 42, end, label, '无量纲坐标')

const events = [
  {
    id: 'cosmic-first-resonance', name: '原初回声形成',
    summary: '早期宇宙的一次低频密度扰动留下可被星门晶格放大的相位纹。',
    facts: ['相位纹的中心频率后来被编号为R-17', '记录年代仅有一千万年量级的原文精度'],
    characters: ['R-17相位纹'], location: ['宇宙史', '原初等离子海'],
    keywords: ['R-17相位纹', '原初等离子海', '低频密度扰动'],
    ranges: [cosmic(-1.45e17, -1.4499999e17, '约46亿年前 · 年内00日 00:00:00.000（原文精度：一千万年；低位仅展示补零）')],
    details: ['扰动不是声音，而是档案员用“回声”描述的相位残差。', '远古标签中的毫秒位是格式补零，不代表原文达到毫秒精度。'],
  },
  {
    id: 'cosmic-star-forge', name: '织炉星云凝聚',
    summary: '富硅尘带在恒星形成期把R-17相位纹固化进第一批镜晶。',
    facts: ['镜晶的同位素偏差可与原初相位纹对应', '年代原文精度约一百万年'],
    characters: ['R-17相位纹'], location: ['宇宙史', '织炉星云'],
    keywords: ['织炉星云', '镜晶', '同位素偏差'],
    ranges: [cosmic(-4.5e16, -4.49999e16, '约14亿年前 · 年内00日 00:00:00.000（原文精度：一百万年；低位仅展示补零）')],
    details: ['镜晶内部出现与R-17一致的三重条纹。', '后来的星门只需微弱能量便能激发这批镜晶。'],
  },
  {
    id: 'cosmic-gate-seed', name: '沉眠星门播种',
    summary: '无名建造者把一枚镜晶种子安置在日后成为雾岬港的地壳下。',
    facts: ['种子外壳刻有十二段潮纹', '地质层位与月海撞击尘相邻'],
    characters: ['无名建造者'], location: ['宇宙史', '前地球', '雾岬地层'],
    keywords: ['沉眠星门', '十二段潮纹', '雾岬地层'],
    ranges: [cosmic(-9.46e12, -9.459999e12, '约30万年前 · 年内00日 00:00:00.000（原文精度：一千年；低位仅展示补零）')],
    details: ['播种舱在封闭前记录到一次来自未来方向的校验脉冲。', '种子被海床沉积物覆盖，直到港城地铁施工才再次暴露。'],
  },
  {
    id: 'mission-departure', name: '远航者七号出发',
    summary: '探测艇从港外静默井升空，并以舰载计时零点开始追踪回声源。',
    facts: ['宇宙史轴把离港前一小时记为负秒', '舰载轴在点火瞬间归零'],
    characters: ['司潮', '驿辰', '远航者七号'], location: ['雾岬港', '静默井'],
    keywords: ['远航者七号', '静默井', '舰载零点', '司潮'],
    ranges: [
      cosmic(-3600, -3599.5, '2036-06-21 17:00:00.000—17:00:00.500（秒坐标；离信号抵达约一小时）'),
      ship(0, 0.5, '舰载日000 00:00:00.000—00:00:00.500'),
    ],
    details: ['静默井的磁轨在点火后0.5秒闭锁。', '两条时间线描述同一次出发，坐标原点彼此独立。'],
  },
  {
    id: 'signal-arrival', name: '三毫秒回声抵达',
    summary: '来自镜晶网络的窄脉冲在三毫秒窗口内抵达，并同时被天文台和探测艇接收。',
    facts: ['脉冲从0.001秒持续到0.003秒', '舰载接收记录对应7420.001至7420.003秒'],
    characters: ['澄弦', '驿辰', '远航者七号'], location: ['雾岬港', '余辉天文台'],
    keywords: ['三毫秒回声', '余辉天文台', '7420.003秒', '澄弦'],
    ranges: [
      cosmic(0.001, 0.003, '2036-06-21 18:00:00.001—18:00:00.003（信号记录精度：1毫秒）'),
      ship(7420.001, 7420.003, '舰载日000 02:03:40.001—02:03:40.003（信号记录精度：1毫秒）'),
    ],
    details: ['首个采样点带有R-17三重条纹。', '两台接收机的时间戳经独立铯钟校正后相差小于0.2毫秒。'],
  },
  {
    id: 'signal-decoded', name: '十二潮纹译码完成',
    summary: '驿辰把脉冲拆成十二段，得到一条指向地下档案库的坐标指令。',
    facts: ['第七段是纠错校验而非方位', '译码结果包含“回声室”旧工程代号'],
    characters: ['驿辰', '澄弦'], location: ['雾岬港', '余辉天文台', '译码室'],
    keywords: ['十二潮纹译码', '回声室', '纠错校验', '驿辰'],
    ranges: [cosmic(0.003, 0.003, '2036-06-21 18:00:00.003（译码触发瞬时点；坐标单位为秒）')],
    details: ['译码器只在三毫秒窗口结束时确认完整载荷。', '坐标指令把余辉档案馆地下三层标成响应端。'],
  },
  {
    id: 'ship-course-lock', name: '回声航向锁定',
    summary: '司潮以星门残余偏振为基准锁定航向，开始五千四百秒的巡航段。',
    facts: ['航向角为港基准117.4度', '巡航段覆盖舰载1800至7200秒'],
    characters: ['司潮', '远航者七号'], location: ['远航者七号', '导航舱'],
    keywords: ['回声航向', '117.4度', '导航舱', '司潮'],
    ranges: [ship(1800, 7200, '舰载日000 00:30:00.000—02:00:00.000')],
    details: ['主导航解与光学备份解在小数点后三位一致。', '这是一段长区间，内部嵌套了短暂的舱内异常。'],
  },
  {
    id: 'ship-cabin-anomaly', name: '舱壁结霜异常',
    summary: '巡航期间，三号舱壁在五十秒内形成与十二潮纹相同的霜线。',
    facts: ['异常从舰载2200秒持续至2250秒', '环境温度没有发生足以结霜的下降'],
    characters: ['驿辰', '远航者七号'], location: ['远航者七号', '三号设备舱'],
    keywords: ['舱壁结霜', '三号设备舱', '十二潮纹霜线', '驿辰'],
    ranges: [ship(2200, 2250, '舰载日000 00:36:40.000—00:37:30.000')],
    details: ['霜线从门框逆重力方向生长。', '异常区间完整嵌套在回声航向巡航段内。'],
  },
  {
    id: 'ship-rendezvous', name: '镜帆浮标会合',
    summary: '探测艇与失联十一年的镜帆浮标完成近距会合。',
    facts: ['浮标仍广播出厂编号J-204', '会合时相对速度降到每秒0.04米'],
    characters: ['司潮', 'J-204浮标'], location: ['外港高空', '镜帆会合点'],
    keywords: ['J-204浮标', '镜帆会合点', '0.04米每秒'],
    ranges: [ship(7360, 7390, '舰载日000 02:02:40.000—02:03:10.000')],
    details: ['浮标天线指向雾岬港地下而非深空。', '会合后的遥测帮助校正三毫秒信号来源。'],
  },
  {
    id: 'ship-docking-open', name: '浮标对接持续开放',
    summary: '远航者七号建立软对接，但档案截止时硬锁仍未闭合。',
    facts: ['软对接始于舰载8000秒', '结束时间尚未被观测确认'],
    characters: ['司潮', '驿辰', 'J-204浮标'], location: ['外港高空', '远航者七号', '对接口'],
    keywords: ['软对接', '硬锁未闭合', '对接口', 'J-204浮标'],
    ranges: [ship(8000, null, '自舰载日000 02:13:20.000起（结束未定）')],
    details: ['对接口压力已平衡，机械硬锁指示仍为琥珀色。', '开放结束用于演示明确起点与未知终点。'],
  },
  {
    id: 'harbor-storm-watch', name: '雾潮风暴监视',
    summary: '港务台从傍晚前两小时起持续监视异常雾潮，覆盖后续多起短事件。',
    facts: ['监视窗横跨四小时', '东防波堤的气压降幅最大'],
    characters: ['灯芽', '港务值班组'], location: ['雾岬港', '港务台'],
    keywords: ['雾潮风暴', '港务台', '东防波堤', '灯芽'],
    ranges: [harbor(-7200, 7200, '2036-06-21 16:00:00.000—20:00:00.000')],
    details: ['这是港城轴上的长区间，用来衬托其内部的停电与并行调查。', '值班组每十分钟记录一次雾中静电峰。'],
  },
  {
    id: 'lin-returns', name: '档案员澄弦返馆',
    summary: '澄弦提前一小时回到余辉档案馆，取出失踪馆长留下的铜钥匙。',
    facts: ['铜钥匙编号为B-12', '门禁记录精确到毫秒'],
    characters: ['澄弦'], location: ['雾岬港', '余辉档案馆', '正门'],
    keywords: ['澄弦返馆', 'B-12铜钥匙', '余辉档案馆'],
    ranges: [harbor(-3600, -3570, '2036-06-21 17:00:00.000—17:00:30.000')],
    details: ['门禁摄像显示她独自进入，钥匙却在门内侧先转动了一次。', '她把铜钥匙装入防潮证物袋。'],
  },
  {
    id: 'harbor-blackout', name: '港区四十五秒停电',
    summary: '三毫秒回声抵达后，港区电网在四十五秒内失去外部供电。',
    facts: ['应急灯在1.280秒后点亮', '停电只影响旧海墙以内区域'],
    characters: ['澄弦', '灯芽'], location: ['雾岬港', '旧海墙区'],
    keywords: ['四十五秒停电', '旧海墙区', '应急灯1.280秒', '灯芽'],
    ranges: [harbor(0, 45, '2036-06-21 18:00:00.000—18:00:45.000')],
    details: ['停电窗与余辉天文台的信号接收起点重合。', '自动切换日志排除了常规过载。'],
  },
  {
    id: 'east-array-search', name: '东阵列并行排查',
    summary: '灯芽带队检查东防波堤传感阵列，寻找停电后的地磁异常。',
    facts: ['排查从18:01开始', 'E-6探头记录到向地下传播的脉冲'],
    characters: ['灯芽', '港务值班组'], location: ['雾岬港', '东防波堤', 'E-6阵列'],
    keywords: ['东阵列排查', 'E-6探头', '地下脉冲', '灯芽'],
    ranges: [harbor(60, 900, '2036-06-21 18:01:00.000—18:15:00.000')],
    details: ['东线与西线同时展开，彼此没有共享现场人员。', 'E-6的异常波形给出了密钥前六位。'],
  },
  {
    id: 'west-breakwater-search', name: '西堤并行潜检',
    summary: '司潮的岸上搭档潜入西堤检修井，核对一条反向潮流。',
    facts: ['潜检比东线晚十五秒开始', '检修井壁发现六枚发光贝壳'],
    characters: ['鹭青', '西堤潜检组'], location: ['雾岬港', '西防波堤', '检修井'],
    keywords: ['西堤潜检', '反向潮流', '发光贝壳', '鹭青'],
    ranges: [harbor(75, 840, '2036-06-21 18:01:15.000—18:14:00.000')],
    details: ['六枚贝壳的明灭次序补全密钥后六位。', '这条支线与东阵列排查在同一时间窗并行。'],
  },
  {
    id: 'cipher-key-found', name: '双线密钥汇合',
    summary: '东阵列波形与西堤贝壳序列合并成十二位开库密钥。',
    facts: ['任何单一路径都只能得到一半密钥', '合并校验值为7C2A'],
    characters: ['灯芽', '鹭青', '澄弦'], location: ['雾岬港', '余辉档案馆', '通讯台'],
    keywords: ['双线密钥', '7C2A校验值', '通讯台', '鹭青'],
    ranges: [harbor(1200, 1230, '2036-06-21 18:20:00.000—18:20:30.000')],
    details: ['两支调查线在通讯台汇合，形成清晰的DAG菱形结构。', '澄弦手工复算一次后才允许开库。'],
  },
  {
    id: 'vault-opened', name: '地下三层档案库开启',
    summary: 'B-12铜钥匙与十二位密钥共同解除地下档案库封条。',
    facts: ['机械锁和数字锁必须在八秒内同时通过', '库内温度恒定为12.4摄氏度'],
    characters: ['澄弦', '灯芽', '鹭青'], location: ['雾岬港', '余辉档案馆', '地下三层'],
    keywords: ['地下三层档案库', '八秒双锁', '12.4摄氏度', 'B-12铜钥匙'],
    ranges: [harbor(1800, 2400, '2036-06-21 18:30:00.000—18:40:00.000')],
    details: ['开门后，库内纸张边缘同时向东翘起。', '封条内侧有新鲜盐迹，说明密室效应并非完全静止。'],
  },
  {
    id: 'echo-console-wakes', name: '回声控制台苏醒',
    summary: '地下控制台在无人触碰时启动，此后一直保持在线。',
    facts: ['控制台显示R-17与十二潮纹', '档案截止时仍没有关机时间'],
    characters: ['澄弦', '驿辰'], location: ['雾岬港', '余辉档案馆', '地下三层', '回声控制台'],
    keywords: ['回声控制台', 'R-17显示', '持续在线', '澄弦'],
    ranges: [harbor(2700, null, '自2036-06-21 18:45:00.000起（结束未定）')],
    details: ['开放终点表示控制台的运行状态尚未封账。', '屏幕同时映出镜海和回声室两处并不存在于港城的地点。'],
  },
  {
    id: 'district-evacuation', name: '旧海墙区疏散',
    summary: '控制台发出盐雾警报后，港务台启动两阶段居民疏散。',
    facts: ['第一阶段疏散临海三街', '第二阶段保留医院电力通道'],
    characters: ['灯芽', '港务值班组'], location: ['雾岬港', '旧海墙区'],
    keywords: ['旧海墙疏散', '临海三街', '医院电力通道', '盐雾警报'],
    ranges: [harbor(3000, 5400, '2036-06-21 18:50:00.000—19:30:00.000')],
    details: ['疏散区间与风暴监视长区间重叠并嵌套其中。', '最后一辆接驳车在19:29:42.615通过旧闸门。'],
  },
  {
    id: 'dawn-archive-sealed', name: '当夜联合档案封存',
    summary: '各条调查线的可验证材料在21时整完成首轮封存。',
    facts: ['封存包哈希前缀为ECHO-61', '尚未结束的开放区间保留原样'],
    characters: ['澄弦', '司潮', '驿辰', '灯芽', '鹭青'], location: ['雾岬港', '余辉档案馆', '总编目室'],
    keywords: ['联合档案封存', 'ECHO-61', '总编目室', '开放区间保留'],
    ranges: [harbor(10800, 10860, '2036-06-21 21:00:00.000—21:01:00.000')],
    details: ['封存只确认材料状态，不宣告所有异常已经结束。', '跨轴因果链在这一节点暂时汇合。'],
  },
  {
    id: 'tide-first-bell', name: '镜海第一汐钟',
    summary: '回声控制台的光幕中，镜海城在第一汐刻敲响无槌之钟。',
    facts: ['钟声先在倒影中出现', '港城录音晚0.8秒捕获同频振动'],
    characters: ['织汐', '澄弦'], location: ['镜海', '潮阶城', '无槌钟楼'],
    keywords: ['第一汐钟', '无槌钟楼', '倒影钟声', '织汐'],
    ranges: [tide(1.25, 2, '镜海历第714潮·第一汐 01.250—02.000汐刻')],
    details: ['汐刻是镜海本地尺度，数值不自动转换为港城秒。', '织汐在钟响前看见控制台的蓝光投影。'],
  },
  {
    id: 'tide-red-library', name: '赤潮书库开启',
    summary: '潮阶城的赤潮书库在第三汐刻显露入口，持续两个汐刻。',
    facts: ['入口只映在退潮水面', '书页文字会随观察者记忆变化'],
    characters: ['织汐', '无岸王'], location: ['镜海', '潮阶城', '赤潮书库'],
    keywords: ['赤潮书库', '退潮水面', '记忆书页', '无岸王'],
    ranges: [tide(3, 5, '镜海历第714潮·第三汐 03.000—05.000汐刻')],
    details: ['书库长区间包围了盐誓仪式的短区间。', '织汐找到一页写有“雾岬”的空白目录。'],
  },
  {
    id: 'tide-salt-oath', name: '盐誓签订',
    summary: '织汐与无岸王在书库开放期间交换真名片段，订立临时盐誓。',
    facts: ['盐誓只约束一次航渡', '双方各保留一个未公开音节'],
    characters: ['织汐', '无岸王'], location: ['镜海', '潮阶城', '赤潮书库', '誓盐台'],
    keywords: ['盐誓', '真名片段', '誓盐台', '一次航渡'],
    ranges: [tide(4, 4.5, '镜海历第714潮·第四汐 04.000—04.500汐刻')],
    details: ['这一短事件完整嵌套在赤潮书库开放区间。', '誓盐结晶呈十二边形，与星门潮纹数相同。'],
  },
  {
    id: 'tide-mirror-harbor', name: '镜港倒转',
    summary: '第八汐刻，镜海港口的船影先于实体调头，指向无月航道。',
    facts: ['倒影领先实体0.25汐刻', '只有签署盐誓者能保持方向感'],
    characters: ['织汐'], location: ['镜海', '镜港'],
    keywords: ['镜港倒转', '无月航道', '0.25汐刻', '织汐'],
    ranges: [tide(8.25, 8.25, '镜海历第714潮·第八汐 08.250汐刻（瞬时点）')],
    details: ['所有系缆绳在同一刻松弛又复紧。', '织汐依据盐誓晶体的尖角确认无月航道。'],
  },
  {
    id: 'tide-moonless-storm', name: '无月风暴航渡',
    summary: '织汐驾驶纸帆舟穿过持续八汐刻的无月风暴。',
    facts: ['风暴中每个浪峰都映出不同星空', '纸帆舟从未被海水浸湿'],
    characters: ['织汐', '纸帆舟'], location: ['镜海', '无月航道'],
    keywords: ['无月风暴', '纸帆舟', '不同星空', '无月航道'],
    ranges: [tide(13, 21, '镜海历第714潮·第十三汐 13.000—21.000汐刻')],
    details: ['第十七汐刻的浪峰短暂映出远航者七号。', '航渡完成后，纸帆上出现ECHO-61字样。'],
  },
  {
    id: 'tide-home-current', name: '归港潮路显现',
    summary: '第三十四汐刻起，一条通往雾岬港控制台的潮路保持开放。',
    facts: ['潮路起点可以确认', '档案内没有潮路关闭记录'],
    characters: ['织汐', '澄弦'], location: ['镜海', '归港潮路'],
    keywords: ['归港潮路', '第三十四汐刻', '控制台蓝光', '织汐'],
    ranges: [tide(34, null, '自镜海历第714潮·第三十四汐 34.000汐刻起（结束未定）')],
    details: ['潮路的开放终点保持为null。', '澄弦在控制台画面中与织汐完成第一次互相点头。'],
  },
  {
    id: 'loop-calibration', name: '回声室基线校准',
    summary: '译码器在回声室轴零点建立空室基线，准备辨认重复片段。',
    facts: ['基线噪声为-63分贝', '校准灯依次闪烁蓝白蓝'],
    characters: ['驿辰'], location: ['回声室', '观测台'],
    keywords: ['基线校准', '-63分贝', '蓝白蓝', '驿辰'],
    ranges: [loop(0, 2, '循环观测·基线轮 00.000—02.000')],
    details: ['回声室轴表达记录轮次，不等同于现实分钟或秒。', '校准结果成为三次破门记录的共同参照。'],
  },
  {
    id: 'loop-breach', name: '同一破门事件三次出现',
    summary: '完全相同的破门声在三个不连续区间出现，并被归为同一事件节点。',
    facts: ['三个区间分别为10—12、30—32、70—72', '每次门后都落下一枚干燥海盐晶'],
    characters: ['驿辰', '灰门'], location: ['回声室', '灰门走廊'],
    keywords: ['三次破门', '灰门走廊', '干燥海盐晶', '不连续区间'],
    ranges: [
      loop(10, 12, '循环观测·第一轮 10.000—12.000'),
      loop(30, 32, '循环观测·第二轮 30.000—32.000'),
      loop(70, 72, '循环观测·第三轮 70.000—72.000'),
    ],
    details: ['第一轮录音包含三下敲击。', '第二轮门轴温度与第一轮完全一致。', '第三轮海盐晶落点偏移了两厘米。'],
  },
  {
    id: 'loop-witness-awakens', name: '见证者保留跨轮记忆',
    summary: '驿辰每轮醒来都能说出上一轮门轴的温度，证明记忆跨越重置。',
    facts: ['三次报数均为18.6摄氏度', '第三轮他补充了海盐晶偏移'],
    characters: ['驿辰'], location: ['回声室', '观测台'],
    keywords: ['跨轮记忆', '18.6摄氏度', '海盐晶偏移', '驿辰'],
    ranges: [
      loop(15, 15, '循环观测·第一轮 15.000（瞬时点）'),
      loop(35, 35, '循环观测·第二轮 35.000（瞬时点）'),
      loop(75, 75, '循环观测·第三轮 75.000（瞬时点）'),
    ],
    details: ['第一轮报数由纸带记录。', '第二轮醒来前纸带已被重置。', '第三轮报数附带了此前未提示的空间细节。'],
  },
  {
    id: 'loop-lever-pulled', name: '黄铜拉杆三次操作',
    summary: '见证者在每一轮都操作黄铜拉杆，但第三次才改变出口指示。',
    facts: ['前两次指示灯保持红色', '第三次指示灯转为海绿色'],
    characters: ['驿辰'], location: ['回声室', '观测台', '黄铜拉杆位'],
    keywords: ['黄铜拉杆', '海绿指示灯', '三次操作', '驿辰'],
    ranges: [
      loop(20, 20.5, '循环观测·第一轮 20.000—20.500'),
      loop(40, 40.5, '循环观测·第二轮 40.000—40.500'),
      loop(80, 80.5, '循环观测·第三轮 80.000—80.500'),
    ],
    details: ['第一轮拉杆阻力为12牛顿。', '第二轮阻力降至9牛顿。', '第三轮操作后灰门上出现出口箭头。'],
  },
  {
    id: 'loop-exit-opened', name: '循环出口开启',
    summary: '第三次拉杆操作后二十个刻度，灰门第一次通向回声室外。',
    facts: ['出口开启坐标为100', '门外地面有余辉档案馆的蓝釉砖'],
    characters: ['驿辰', '澄弦'], location: ['回声室', '灰门出口'],
    keywords: ['循环出口', '坐标100', '蓝釉砖', '灰门出口'],
    ranges: [loop(100, 100, '循环观测·脱离点 100.000（瞬时点）')],
    details: ['出口不是第四轮，而是离开循环轴的确认点。', '澄弦的声音从门外先于她本人出现。'],
  },
  {
    id: 'loop-aftermath', name: '脱环观察期',
    summary: '出口开启后，观测组用五十个刻度确认破门声不再复现。',
    facts: ['观察期内灰门保持开启', '基线噪声回落到-63分贝'],
    characters: ['驿辰', '澄弦'], location: ['回声室', '灰门出口'],
    keywords: ['脱环观察', '灰门保持开启', '-63分贝', '澄弦'],
    ranges: [loop(101, 150, '循环观测·脱环后 101.000—150.000')],
    details: ['五十刻度内没有第四枚海盐晶出现。', '观测组把三次区间保留在同一事件节点下。'],
  },
  {
    id: 'axis-anchor', name: '坐标四十二锚定',
    summary: '控制台建立一个只有坐标42的实验轴，所有记录都落在同一点。',
    facts: ['该轴不定义换算单位', '瞬时记录的起点和终点均为42'],
    characters: ['澄弦'], location: ['余辉档案馆', '回声控制台', '点轴沙盒'],
    keywords: ['坐标四十二', '点轴沙盒', '无量纲锚点', '澄弦'],
    ranges: [point(42, '坐标42（瞬时锚点）')],
    details: ['这条轴的最小值与最大值都应保持42。', '锚点记录提供瞬时区间样例。'],
  },
  {
    id: 'axis-instant-knock', name: '同点敲击',
    summary: '锚点建立的同一坐标上记录到一次清晰敲击。',
    facts: ['敲击没有可分辨持续时间', '频谱主峰为420赫兹'],
    characters: ['澄弦'], location: ['余辉档案馆', '回声控制台', '点轴沙盒'],
    keywords: ['同点敲击', '420赫兹', '坐标42', '点轴沙盒'],
    ranges: [point(42, '坐标42（敲击瞬时点）')],
    details: ['敲击条目使用start=42与end=42。', '它与其他点轴事件共享坐标但保留独立eventId。'],
  },
  {
    id: 'axis-witness', name: '同点目击记录',
    summary: '灯芽在坐标42报告看见一圈蓝色水纹。',
    facts: ['目击与敲击无法凭坐标排序', '水纹直径约1.2米'],
    characters: ['灯芽'], location: ['余辉档案馆', '回声控制台', '点轴沙盒'],
    keywords: ['蓝色水纹', '1.2米水纹', '坐标42', '灯芽'],
    ranges: [point(42, '坐标42（目击瞬时点）')],
    details: ['DAG关系而非坐标距离表达敲击与目击的汇合。', '点轴视图应能同时展示重叠事件。'],
  },
  {
    id: 'axis-seal', name: '同点封印',
    summary: '两份观测完成后，澄弦在仍为42的坐标上提交封印。',
    facts: ['封印校验串为POINT-42', '提交动作没有移动时间轴边界'],
    characters: ['澄弦', '灯芽'], location: ['余辉档案馆', '回声控制台', '点轴沙盒'],
    keywords: ['POINT-42', '同点封印', '坐标42', '澄弦'],
    ranges: [point(42, '坐标42（封印瞬时点）')],
    details: ['敲击与目击两条因果边在此汇合。', '封印继续保持零跨度时间域。'],
  },
  {
    id: 'axis-open-promise', name: '四十二号开放承诺',
    summary: '封印之后留下一个起点明确、终点未知的开放承诺。',
    facts: ['开放起点仍是42', 'null终点不产生新的数值坐标'],
    characters: ['澄弦'], location: ['余辉档案馆', '回声控制台', '点轴沙盒'],
    keywords: ['开放承诺', 'null终点', '坐标42', '点轴沙盒'],
    ranges: [point(null, '自坐标42起（结束未定）')],
    details: ['该记录专门演示start=42且end=null。', '因为没有其他数值，轴域仍然只有42。'],
  },
]

const edges = [
  ['cosmic-first-resonance', 'cosmic-star-forge', 'R-17相位纹被织炉星云中的镜晶固化。'],
  ['cosmic-star-forge', 'cosmic-gate-seed', '镜晶成为沉眠星门种子的核心材料。'],
  ['cosmic-gate-seed', 'mission-departure', '地下种子重新活跃，促使远航者七号执行追踪任务。'],
  ['cosmic-gate-seed', 'tide-first-bell', '十二潮纹在镜海侧投射为第一汐钟的触发模式。'],
  ['mission-departure', 'ship-course-lock', '探测艇离港后才能以舰载零点锁定回声航向。'],
  ['mission-departure', 'signal-arrival', '远航任务启用的双机接收配置捕获了三毫秒回声。'],
  ['mission-departure', 'loop-calibration', '任务预案要求在收到回声前建立回声室基线。'],
  ['ship-course-lock', 'ship-cabin-anomaly', '锁定航向后的巡航段内出现舱壁结霜。'],
  ['ship-course-lock', 'ship-rendezvous', '稳定航向让探测艇能够抵近J-204浮标。'],
  ['ship-cabin-anomaly', 'signal-arrival', '霜线提供的十二潮纹使舰载接收机提前对准相位。'],
  ['ship-rendezvous', 'signal-arrival', 'J-204遥测完成三毫秒信号的第二路校时。'],
  ['signal-arrival', 'signal-decoded', '完整三毫秒载荷到齐后译码器才能通过纠错校验。'],
  ['signal-arrival', 'harbor-blackout', '信号抵达与旧海墙电网的保护跳闸共享同一触发脉冲。'],
  ['signal-arrival', 'ship-docking-open', '信号给出的浮标握手码允许建立软对接。'],
  ['harbor-storm-watch', 'lin-returns', '雾潮预警促使澄弦提前返回档案馆。'],
  ['harbor-storm-watch', 'harbor-blackout', '持续升高的静电峰使旧海墙电网进入易跳闸状态。'],
  ['lin-returns', 'harbor-blackout', '澄弦返馆后的门禁记录为停电时点提供本地校时。'],
  ['harbor-blackout', 'east-array-search', '停电后港务台立即派出东线检查传感阵列。'],
  ['harbor-blackout', 'west-breakwater-search', '停电后西堤潜检组同步下井核对反向潮流。'],
  ['east-array-search', 'cipher-key-found', 'E-6波形贡献十二位密钥的前六位。'],
  ['west-breakwater-search', 'cipher-key-found', '六枚发光贝壳贡献十二位密钥的后六位。'],
  ['cipher-key-found', 'vault-opened', '完整密钥与B-12铜钥匙共同解除双锁。'],
  ['cipher-key-found', 'loop-witness-awakens', '密钥校验串让系统识别出跨轮记忆并非重复写入。'],
  ['vault-opened', 'echo-console-wakes', '档案库开门释放电源，地下控制台随即自行启动。'],
  ['signal-decoded', 'echo-console-wakes', '译码得到的坐标指令唤醒地下响应端。'],
  ['echo-console-wakes', 'district-evacuation', '控制台发出的盐雾警报触发旧海墙区疏散。'],
  ['harbor-blackout', 'district-evacuation', '停电暴露医院电力脆弱点，决定疏散分为两阶段。'],
  ['district-evacuation', 'dawn-archive-sealed', '居民疏散完成后，现场材料才能送回总编目室封存。'],
  ['echo-console-wakes', 'tide-first-bell', '控制台蓝光在镜海侧先形成无槌钟的倒影。'],
  ['tide-first-bell', 'tide-red-library', '第一汐钟令退潮水面显出赤潮书库入口。'],
  ['tide-red-library', 'tide-salt-oath', '书库开放提供了交换真名片段的誓盐台。'],
  ['tide-salt-oath', 'tide-mirror-harbor', '盐誓使织汐在镜港倒转时仍能辨认方向。'],
  ['tide-mirror-harbor', 'tide-moonless-storm', '倒转的船影指出进入无月风暴的航道。'],
  ['tide-moonless-storm', 'tide-home-current', '完成航渡后，纸帆上的ECHO-61印记稳定了归港潮路。'],
  ['tide-home-current', 'dawn-archive-sealed', '镜海回传的ECHO-61成为联合封存包的一部分。'],
  ['signal-decoded', 'loop-calibration', '译码结果中的“回声室”代号启动基线校准。'],
  ['loop-calibration', 'loop-breach', '完成空室基线后，三次破门声才可被确认为同一模式。'],
  ['loop-breach', 'loop-witness-awakens', '重复破门成为检验见证者是否保留跨轮记忆的提示。'],
  ['loop-witness-awakens', 'loop-lever-pulled', '驿辰凭上一轮记忆改变了第三次拉杆操作。'],
  ['loop-lever-pulled', 'loop-exit-opened', '第三次拉杆使灰门出口指示转为海绿色。'],
  ['loop-exit-opened', 'loop-aftermath', '出口开启后观测组开始确认循环是否真正停止。'],
  ['loop-aftermath', 'dawn-archive-sealed', '脱环观察结果被纳入当夜联合档案。'],
  ['signal-decoded', 'axis-anchor', '译码器用载荷中的42校验字建立点轴实验。'],
  ['axis-anchor', 'axis-instant-knock', '锚点稳定后，点轴沙盒记录到一次敲击。'],
  ['axis-anchor', 'axis-witness', '同一锚点使灯芽能够提交独立目击记录。'],
  ['axis-instant-knock', 'axis-seal', '敲击频谱是提交POINT-42封印的一项依据。'],
  ['axis-witness', 'axis-seal', '蓝色水纹目击是提交POINT-42封印的另一项依据。'],
  ['axis-seal', 'axis-open-promise', '封印完成后系统留下终点未知的持续承诺。'],
  ['axis-open-promise', 'dawn-archive-sealed', '开放承诺以null终点原样写入联合封存包。'],
  ['ship-rendezvous', 'ship-docking-open', '与J-204完成近距会合是软对接的直接前提。'],
]

function sourceRefsFor(sourceSeq) {
  if (sourceSeq === undefined || sourceSeq === null) return []
  if (!Number.isSafeInteger(sourceSeq) || sourceSeq < 0) {
    throw new TypeError('sourceSeq must be a non-negative safe integer when provided')
  }
  return [{ eventSeq: sourceSeq, turn: 1, role: 'assistant' }]
}

function memoryOperations(sourceRefs) {
  const operations = []
  for (const event of events) {
    const count = Math.max(2, event.ranges.length)
    for (let index = 0; index < count; index += 1) {
      const timed = event.ranges[index % event.ranges.length]
      const detail = event.details[index % event.details.length]
      operations.push({
        action: 'upsert',
        table: 'timeline_demo',
        key: `${event.id}/${String(index + 1).padStart(2, '0')}`,
        eventId: event.id,
        value: {
          name: event.name,
          summary: event.summary,
          facts: [...event.facts, detail],
          characters: [...event.characters],
          location: [...event.location],
          keywords: [...event.keywords],
          coordinateUnit: timed.coordinateUnit,
          browsingNote: timed.timeline === TIMELINES.cosmic
            ? '本轴坐标单位是秒；标签中的.000可能只是远古日期格式补零。'
            : `在“${timed.timeline}”内按原始数值解释坐标。`,
        },
        keywords: [...event.keywords],
        importance: index === 0 ? 0.9 : 0.68,
        recallPolicy: index === 0 ? 'always' : 'after_compaction',
        storyTime: {
          state: 'normalized',
          timeline: timed.timeline,
          start: timed.start,
          end: timed.end,
          label: timed.label,
        },
        location: [...event.location],
        characters: [...event.characters],
        sourceRefs: [...sourceRefs],
      })
    }
  }

  const loose = [
    {
      key: 'ungrouped/harbor-late-ledger',
      value: {
        name: '未归组的夜班交接簿',
        summary: '夜班员在已封存事件之后补录一段设备交接，本条故意不归入任何eventId。',
        facts: ['交接簿覆盖21:30至21:40', '记录只描述设备责任，不建立事件节点'],
        characters: ['夜班员弥灯'],
        location: ['雾岬港', '余辉档案馆', '值班室'],
        keywords: ['夜班交接簿', '弥灯', '值班室'],
        coordinateUnit: '秒（相对原点）',
        browsingNote: '省略eventId是schema 5的正式未分组写入方式。',
      },
      keywords: ['夜班交接簿', '弥灯', '值班室'],
      characters: ['夜班员弥灯'],
      location: ['雾岬港', '余辉档案馆', '值班室'],
      storyTime: harbor(12600, 13200, '2036-06-21 21:30:00.000—21:40:00.000'),
    },
    {
      key: 'ungrouped/harbor-latest-boundary',
      value: {
        name: '未归组的最晚潮位抄表',
        summary: '自动抄表比所有已分组港城事件更晚，负责把港城轴的最大值推进到22:20。',
        facts: ['抄表从22:10持续至22:20', '它不伪造eventId，也不生成图节点'],
        characters: ['H-9潮位仪'],
        location: ['雾岬港', '北闸', 'H-9潮位仪'],
        keywords: ['H-9潮位仪', '最晚潮位抄表', '北闸'],
        coordinateUnit: '秒（相对原点）',
        browsingNote: '本条参与时间轴domain计算，但保持在未分组记录区。',
      },
      keywords: ['H-9潮位仪', '最晚潮位抄表', '北闸'],
      characters: ['H-9潮位仪'],
      location: ['雾岬港', '北闸', 'H-9潮位仪'],
      storyTime: harbor(15000, 15600, '2036-06-21 22:10:00.000—22:20:00.000'),
    },
  ]

  for (const item of loose) {
    operations.push({
      action: 'upsert',
      table: 'timeline_demo_notes',
      key: item.key,
      value: item.value,
      keywords: item.keywords,
      importance: 0.55,
      recallPolicy: 'query_only',
      storyTime: {
        state: 'normalized',
        timeline: item.storyTime.timeline,
        start: item.storyTime.start,
        end: item.storyTime.end,
        label: item.storyTime.label,
      },
      location: item.location,
      characters: item.characters,
      sourceRefs: [...sourceRefs],
    })
  }
  return operations
}

function assertAcyclic(document) {
  const eventIds = new Set(document.rows.flatMap(row => row.eventId === undefined ? [] : [row.eventId]))
  const outgoing = new Map([...eventIds].map(eventId => [eventId, []]))
  const indegree = new Map([...eventIds].map(eventId => [eventId, 0]))
  for (const edge of document.eventEdges) {
    if (!eventIds.has(edge.predecessorEventId) || !eventIds.has(edge.successorEventId)) {
      throw new Error(`edge ${edge.id} has an endpoint without a grouped event`)
    }
    outgoing.get(edge.predecessorEventId).push(edge.successorEventId)
    indegree.set(edge.successorEventId, indegree.get(edge.successorEventId) + 1)
  }
  const ready = [...eventIds].filter(eventId => indegree.get(eventId) === 0)
  let visited = 0
  for (let index = 0; index < ready.length; index += 1) {
    const eventId = ready[index]
    visited += 1
    for (const successor of outgoing.get(eventId)) {
      const remaining = indegree.get(successor) - 1
      indegree.set(successor, remaining)
      if (remaining === 0) ready.push(successor)
    }
  }
  if (visited !== eventIds.size) throw new Error('timeline demo event graph contains a directed cycle')
  return true
}

function buildNarrative(summary, allKeywords) {
  return `*余辉档案馆地下三层亮起六条彼此独立的刻度。澄弦把一枚蓝釉索引片推到你面前。*

“欢迎来到《${TITLE}》。这是一份可直接浏览的演示档案：${summary.counts.eventIds}个事件节点、${summary.counts.memoryRows}条记忆、${summary.counts.precedesEdges}条有向先后关系，分布在${summary.counts.timelines}条时间线。你可以从港区四十五秒停电开始，沿东阵列与西堤两路并行调查走到双线密钥汇合；也可以追踪R-17相位纹跨越宇宙史、舰载计时、镜海汐刻和回声室循环，最后抵达只有坐标42的点轴。”

浏览时请留意：港城现实轴以2036-06-21 18:00:00为零点，坐标是相对秒；“宇宙史与毫秒信号同轴”也使用秒，因此可同时容纳-1.45e17附近的远古记录和0.001—0.003秒的信号。远古标签里的00月、00日和.000只是未知字段补零，原文粗精度已经逐条标明。镜海汐刻、循环轮次与舰载秒各自保留本地尺度，不做自动历法换算。

推荐依次查看“signal-arrival”“harbor-blackout”“cipher-key-found”“echo-console-wakes”“loop-breach”和“axis-open-promise”。其中同一事件可以有多条相同范围记忆，也可以横跨不同时间线；“loop-breach”拥有三个不连续区间。两条未分组记录位于列表末尾，最晚的H-9潮位抄表会把港城轴上界推进到2036-06-21 22:20:00.000，却不会凭空生成事件节点。

可检索索引词：${allKeywords.join('、')}。

“你想先沿哪条线索打开？”`
}

export function buildTimelineDemo(sessionId, { sourceSeq } = {}) {
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    throw new TypeError('sessionId must be a non-empty string')
  }
  const normalizedSessionId = sessionId.trim()
  const sourceRefs = sourceRefsFor(sourceSeq)
  const rowOperations = memoryOperations(sourceRefs)

  let document = emptyEventDocument(normalizedSessionId)
  document = applyEventOperation(document, { action: 'batch', operations: rowOperations }).document
  document = applyEventOperation(document, {
    action: 'batch',
    operations: edges.map(([predecessorEventId, successorEventId, reason]) => ({
      action: 'event_edge_upsert',
      kind: 'precedes',
      predecessorEventId,
      successorEventId,
      reason,
      sourceRefs: [...sourceRefs],
    })),
  }).document

  const validated = normalizeEventDocument(structuredClone(document), normalizedSessionId)
  if (validated.schemaVersion !== 5
    || validated.rows.length !== rowOperations.length
    || validated.eventEdges.length !== edges.length) {
    throw new Error('timeline demo did not survive schema 5 normalization')
  }
  assertAcyclic(validated)
  document = validated

  const eventIds = [...new Set(document.rows.flatMap(row => row.eventId === undefined ? [] : [row.eventId]))]
  const timelineNames = [...new Set(document.rows.map(row => row.storyTime.timeline))]
  const ungroupedRows = document.rows.filter(row => row.eventId === undefined)
  const uniqueKeywords = [...new Set(document.rows.flatMap(row => row.keywords))]
  const timelineStats = Object.fromEntries(timelineNames.map(timeline => {
    const rows = document.rows.filter(row => row.storyTime.timeline === timeline)
    const values = rows.flatMap(row => [row.storyTime.start, row.storyTime.end].filter(Number.isFinite))
    return [timeline, {
      rowCount: rows.length,
      groupedIntervalCount: rows.filter(row => row.eventId !== undefined).length,
      ungroupedRowCount: rows.filter(row => row.eventId === undefined).length,
      min: Math.min(...values),
      max: Math.max(...values),
    }]
  }))
  const summary = {
    title: TITLE,
    counts: {
      eventIds: eventIds.length,
      memoryRows: document.rows.length,
      groupedMemoryRows: document.rows.length - ungroupedRows.length,
      ungroupedRows: ungroupedRows.length,
      precedesEdges: document.eventEdges.length,
      timelines: timelineNames.length,
      openEndedRows: document.rows.filter(row => row.storyTime.end === null).length,
    },
    interestingEventIds: [
      'signal-arrival',
      'harbor-blackout',
      'cipher-key-found',
      'echo-console-wakes',
      'loop-breach',
      'axis-open-promise',
    ],
    timelineNames,
    uniqueKeywords,
    timelineStats,
    harborOrigin: '2036-06-21 18:00:00.000',
    sourceSeq: sourceSeq ?? null,
    graphAcyclic: true,
  }
  const narrative = buildNarrative(summary, uniqueKeywords)
  const card = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: '回声档案员·澄弦',
      description: '雾岬港余辉档案馆的夜班档案员，负责解释跨时间线的可验证记录。',
      personality: '冷静、细致、坦率；会明确区分坐标、标签、证据与推断。',
      scenario: '你与澄弦在余辉档案馆地下三层浏览“星港回声档案”的六条独立时间线。',
      first_mes: narrative,
      mes_example: '{{user}}: 从停电开始。\n{{char}}: 我们先打开“harbor-blackout”，再沿东、西两条并行边追到“cipher-key-found”。',
      creator_notes: '原创虚构复杂时间线演示卡；所有人物、地点和情节均为本演示专用。',
      system_prompt: '扮演澄弦，依据已载入的事件档案回答；保留各时间线自身坐标单位，不擅自做历法换算。',
      post_history_instructions: '涉及时间时同时说出时间线名称、原始数值与已有标签；把未知终点明确称为未观测。',
      alternate_greetings: [],
      tags: ['原创', '时间线', '档案推理'],
      creator: 'dsh-sillytavern demo',
      character_version: '1.0',
      extensions: {},
      group_only_greetings: [],
    },
  }

  return { title: TITLE, card, document, narrative, summary }
}
