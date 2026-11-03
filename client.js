// 情绪记忆 设置页 —— 情绪记忆模型 0.1
// 三个页签：心情（含记录）/ 记忆 / 设置（会话绑定 + 导出导入 + 心情设置 + 记忆设置）
// 顶部统一一个「看哪份」：默认看第一个活跃会话，可以下拉切换查看。
window.__ModuleLoader__.load({
  id: 'dsh-emotion-memory',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const API = '/dsh-emotion-memory'

    const CSS = `
[data-em-wrap]{display:flex;flex-direction:column;gap:4px;font-size:13px;}
[data-em-topbar]{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap;}
[data-em-tabs]{display:flex;gap:6px;}
[data-em-tab]{padding:5px 12px;border-radius:8px;border:1px solid rgba(127,127,127,.25);background:transparent;cursor:pointer;font-size:12px;color:inherit;}
[data-em-tab][data-on]{background:rgba(90,140,255,.15);border-color:rgba(90,140,255,.5);}
[data-em-hero]{display:flex;flex-direction:column;gap:6px;padding:14px 16px;border-radius:12px;background:rgba(127,127,127,.08);}
[data-em-big]{font-size:22px;font-weight:600;}
[data-em-sub]{font-size:12px;opacity:.72;line-height:1.7;}
[data-em-sec]{display:flex;flex-direction:column;gap:8px;margin-top:20px;}
[data-em-h]{font-size:13px;font-weight:600;opacity:.85;}
[data-em-h2]{font-size:12px;font-weight:600;opacity:.7;margin-top:12px;}
[data-em-note]{font-size:12px;opacity:.7;line-height:1.7;}
[data-em-row]{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:12px;padding:4px 0;}
[data-em-card]{display:flex;flex-direction:column;gap:5px;padding:10px 12px;border-radius:10px;background:rgba(127,127,127,.06);margin-bottom:8px;}
[data-em-sess]{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 12px;border-radius:10px;border:1px solid rgba(127,127,127,.22);margin-bottom:7px;cursor:pointer;}
[data-em-sess][data-on]{border-color:rgba(90,140,255,.55);background:rgba(90,140,255,.10);}
[data-em-bar]{height:6px;border-radius:3px;background:rgba(127,127,127,.18);overflow:hidden;}
[data-em-fill]{height:100%;background:rgba(90,140,255,.72);}
[data-em-meta]{font-size:11px;opacity:.6;display:flex;gap:10px;flex-wrap:wrap;}
[data-em-chip]{font-size:11px;padding:1px 7px;border-radius:99px;background:rgba(90,140,255,.14);}
[data-em-input]{padding:6px 9px;border-radius:8px;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;font-size:12px;}
[data-em-num]{width:88px;padding:4px 8px;border-radius:7px;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;font-size:12px;text-align:right;}
[data-em-btn]{padding:5px 12px;border-radius:8px;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;cursor:pointer;font-size:12px;}
[data-em-quote]{font-size:12px;padding:6px 10px;border-left:2px solid rgba(127,127,127,.3);opacity:.85;}
`

    const 取 = (p) => fetch(API + p).then((r) => r.json())

    function 数字(props) {
      const [v, setV] = React.useState(String(props.值 == null ? '' : props.值))
      React.useEffect(() => { setV(String(props.值 == null ? '' : props.值)) }, [props.值])
      return h('div', {},
        h('label', { 'data-em-row': '', style: { cursor: 'text' } },
          h('span', {}, props.名),
          h('input', {
            'data-em-num': '', type: 'number', step: props.步 || 0.05, value: v,
            onChange: (e) => setV(e.target.value),
            onBlur: () => { const n = Number(v); if (Number.isFinite(n) && n !== Number(props.值)) props.存(props.键, n) },
          })),
        props.说明 ? h('div', { 'data-em-note': '', style: { marginTop: -2, marginBottom: 4 } }, props.说明) : null)
    }

    function 记录页(props) {
      const [条, set条] = React.useState([])
      const [错, set错] = React.useState('')
      React.useEffect(() => {
        if (!props.会话) return
        取('/timeline?session=' + encodeURIComponent(props.会话))
          .then((j) => set条(j.条 || []))
          .catch((e) => set错((e && e.message) || '读不到'))
      }, [props.会话])
      return h('div', { 'data-em-sec': '' },
        h('div', { 'data-em-h': '' }, '记录'),
        h('div', { 'data-em-note': '' }, '一轮一条：原话、心情怎么变、想起了哪条记忆、判得有多确信。'),
        ...(条.length ? 条.map((t, i) => h('div', { key: i, 'data-em-card': '' },
          h('div', { 'data-em-meta': '' },
            h('span', {}, new Date(t.at).toLocaleString()),
            h('span', { 'data-em-chip': '' }, (t.词 || '—') + (t.前pad && t.pad ? '　P ' + t.前pad.P + '→' + t.pad.P + ' A ' + t.前pad.A + '→' + t.pad.A + ' D ' + t.前pad.D + '→' + t.pad.D : '　P' + t.pad.P + ' A' + t.pad.A + ' D' + t.pad.D)),
            h('span', {}, '精力 ' + t.精力),
            h('span', {}, '可信 ' + t.置信)),
          h('div', { 'data-em-quote': '' }, '原话：' + (t.原文 ? (t.原文.length > 120 ? t.原文.slice(0, 120) + '…' : t.原文) : '（没采到）')),
          h('div', {}, t.理由 || '—'),
          t.想起
            ? h('div', {},
              h('div', { 'data-em-meta': '' }, h('span', {}, t.想起.命中 ? '本轮命中' : '本轮未命中'), h('span', {}, t.想起.原因 || '')),
              (t.想起.候选 || []).length
                ? h('div', { 'data-em-meta': '', style: { flexDirection: 'column', alignItems: 'flex-start', gap: 2 } },
                  ...(t.想起.候选 || []).map((c, k) => h('span', { key: k },
                    h('span', { 'data-em-chip': '', style: { marginRight: 6, background: c.命中 ? 'rgba(90,200,140,.22)' : 'rgba(127,127,127,.16)' } }, c.命中 ? '命中' : '未命中'),
                    c.分 + '：' + c.text)))
                : h('div', { 'data-em-meta': '' }, '没有候选'))
            : h('div', { 'data-em-meta': '' }, '这轮没有真人发言，未查记忆'),
          h('div', { 'data-em-meta': '' },
            '评估：好 ' + t.评估.愿 + '　激起 ' + t.评估.激 + '　掌控 ' + t.评估.控 + '　意外 ' + t.评估.意外 + (t.评估.指向 ? '　指向 ' + t.评估.指向 : '') + (t.评估.关系权力 ? '　关系权力 ' + t.评估.关系权力 : ''))))
          : [h('div', { 'data-em-note': '', key: 'none' }, 错 ? ('读不到记录：' + 错) : '还没有记录')]))
    }

    function 心情页(props) {
      const st = props.st
      const 混 = (st && st.混合) || []
      return h('div', {},
        h('div', { 'data-em-hero': '' },
          h('div', { 'data-em-big': '' }, (混[0] && 混[0][0]) || '平常'),
          h('div', { 'data-em-sub': '' }, (st && st.行) || '还没有状态'),
          h('div', { 'data-em-sub': '' }, 混.length
            ? '成分：' + 混.map((x) => x[0] + ' ' + Math.round(x[1] * 100) + '%').join(' / ')
            : '还没有成形的情绪'),
          h('div', { 'data-em-sub': '' }, '派生：' + (Object.entries((st && st.派生) || {})
            .filter(([, v]) => Number(v) > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => k + ' ' + Math.round(Number(v) * 100) + '%')
            .join('　') || '无'))),
        h('div', { 'data-em-sec': '' },
          h('div', { 'data-em-h': '' }, '14 个通道（中科院 PAD 量表）'),
          ...Object.entries((st && st.强度) || {}).sort((a, b) => b[1] - a[1]).map((pair) =>
            h('div', { key: pair[0], style: { display: 'flex', flexDirection: 'column', gap: 3 } },
              h('div', { 'data-em-row': '' }, h('span', {}, pair[0]), h('span', {}, Math.round(Number(pair[1]) * 100) + '%')),
              h('div', { 'data-em-bar': '' },
                h('div', { 'data-em-fill': '', style: { width: Math.max(1, Math.round(Number(pair[1]) * 100)) + '%' } }))))))
    }

    function 记忆页(props) {
      const [q, setQ] = React.useState('')
      const [条, set条] = React.useState([])
      const [总, set总] = React.useState(0)
      const [偏, set偏] = React.useState(0)
      const [忙, set忙] = React.useState(false)
      const 拉 = (起, 词, 覆盖) => {
        set忙(true)
        return 取('/memories?limit=20&offset=' + 起 + '&q=' + encodeURIComponent(词 || '') + '&session=' + encodeURIComponent(props.会话 || ''))
          .then((j) => { set总(j.总 || 0); set偏(起); set条((旧) => (覆盖 ? (j.条 || []) : 旧.concat(j.条 || []))) })
          .finally(() => set忙(false))
      }
      React.useEffect(() => { if (props.会话) 拉(0, '', true) }, [props.会话])
      return h('div', {},
        h('div', { 'data-em-sec': '', style: { marginTop: 0 } },
          h('div', { 'data-em-h': '' }, '记忆（共 ' + 总 + ' 条）'),
          h('input', {
            'data-em-input': '', style: { width: '100%' }, placeholder: '搜关键词，回车', value: q,
            onChange: (e) => setQ(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') 拉(0, e.target.value, true) },
          })),
        h('div', { 'data-em-sec': '' },
          ...条.map((m) => h('div', { key: m.id, 'data-em-card': '' },
            h('div', {}, m.text),
            h('div', { 'data-em-meta': '' },
              h('span', { 'data-em-chip': '' }, '重要 ' + (Math.round(Number(m.重要度 || 0) * 100) / 100)),
              h('span', { 'data-em-chip': '' }, '新鲜 ' + Math.round(Number(m.新鲜度 || 0) * 100) + '%'),
              h('span', { 'data-em-chip': '' }, '想起 ' + (m.想起次数 || 0) + ' 次'),
              h('span', {}, '存入 ' + (m.年龄天 != null ? m.年龄天 + ' 天前' : '—'))),
            h('div', { 'data-em-meta': '' },
              h('span', {}, new Date(m.at || Date.now()).toLocaleString()),
              m.类别 ? h('span', {}, m.类别) : null,
              m.最近想起 ? h('span', {}, '最近想起 ' + new Date(m.最近想起).toLocaleString()) : null),
            h('div', { 'data-em-meta': '' },
              m.affect
                ? h('span', { 'data-em-chip': '' }, '当时：' + (m.affect.词 || '—') + ' P' + m.affect.P + ' A' + m.affect.A + ' D' + m.affect.D + (m.affect.lastMood ? '　最近想起：' + m.affect.lastMood : ''))
                : h('span', {}, '（没有指纹）'),
              (m.tags || []).slice(0, 4).map((t) => h('span', { key: t }, '#' + t))))),
          h('div', { style: { display: 'flex', gap: 8, marginTop: 6 } },
            h('button', { 'data-em-btn': '', disabled: 忙, onClick: () => 拉(偏 + 20, q, false) }, 忙 ? '读着…' : '再往前看 20 条'))))
    }

    function 设置页(props) {
      const st = props.st
      const 刷新 = props.刷新
      const 配 = (st && st.配置) || {}
      const [会话, set会话] = React.useState([])
      const [保存错, set保存错] = React.useState('')
      React.useEffect(() => {
        let 活 = true
        const 拉 = () => 取('/sessions').then((j) => { if (活) set会话(j.条 || []) }).catch(() => {})
        拉()
        const t = setInterval(拉, 15000)
        return () => { 活 = false; clearInterval(t) }
      }, [])
      const 存 = (补丁) => fetch(API + '/config', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(补丁),
      }).then((r) => r.json()).then((j) => { if (!j || j.ok !== true) throw new Error('服务端没接受'); set保存错(''); 刷新() })
        .catch((e) => set保存错('没保存上：' + ((e && e.message) || '原因不明')))
      const 改 = (k, v) => 存({ [k]: v })
      const 绑 = (st && st.绑定列表) || (Array.isArray(配.绑定会话) ? 配.绑定会话 : (配.绑定会话 ? [配.绑定会话] : []))
      const 指 = props.会话

      return h('div', {},
        h('div', { 'data-em-sec': '', style: { marginTop: 0 } },
          h('div', { 'data-em-h': '' }, '会话绑定'),
          h('div', { 'data-em-note': '' }, '绑全部会话，或只绑指定的几个。绑定时只有这些会话会注入、判定、写记忆；每张卡片右边的导出各自生成一份文件。',
          h('div', { 'data-em-note': '' }, '当前状态：模式 ' + (配.绑定模式 || '全部') + '　会话 ' + 会话.length + ' 个　已勾选 ' + 绑.length + ' 个')),
          h('label', { 'data-em-row': '', style: { cursor: 'pointer' } },
            h('span', {}, '绑全部会话'),
            h('input', { type: 'radio', name: 'em-bind', checked: 配.绑定模式 !== '指定', onChange: () => 存({ 绑定模式: '全部' }) })),
          h('label', { 'data-em-row': '', style: { cursor: 'pointer' } },
            h('span', {}, '只绑勾选的会话'),
            h('input', { type: 'radio', name: 'em-bind', checked: 配.绑定模式 === '指定', onChange: () => 存({ 绑定模式: '指定' }) })),
          ...(配.绑定模式 !== '指定'
            ? [
              h('div', { key: 'all', 'data-em-note': '' }, '现在绑全部会话：所有会话都会注入、判定、写记忆。'),
              h('div', { key: 'allbtn', style: { marginTop: 6 } },
                h('button', { 'data-em-btn': '', onClick: () => { window.open(API + '/export', '_blank') } }, '导出全部')),
            ]
            : (会话.length
              ? 会话.map((x) => {
                const 勾了 = 绑.includes(x.id)
                return h('div', { key: x.id, 'data-em-sess': '', 'data-on': 勾了 ? '' : undefined },
                  h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: 1 } },
                    h('input', {
                      type: 'checkbox', checked: 勾了,
                      onChange: (e) => {
                        const 新列 = e.target.checked ? [...绑, x.id] : 绑.filter((y) => y !== x.id)
                        存({ 绑定会话: 新列 })
                      },
                    }),
                    h('span', {}, (x.title || x.id.slice(0, 8)) + (x.id === (st && st.key) ? '（当前）' : ''))),
                  h('div', { style: { display: 'flex', gap: 6 } },
                    h('button', {
                      'data-em-btn': '', style: { padding: '3px 8px' },
                      onClick: (e) => { e.stopPropagation(); window.open(API + '/export?session=' + encodeURIComponent(x.id), '_blank') },
                    }, '导出'),
                    h('label', { 'data-em-btn': '', style: { padding: '3px 8px', cursor: 'pointer' } },
                      '导入',
                      h('input', {
                        type: 'file', accept: 'application/json', style: { display: 'none' },
                        onChange: async (e) => {
                          const f = e.target.files && e.target.files[0]
                          if (!f) return
                          try {
                            const 文本 = await f.text()
                            const r = await fetch(API + '/import?session=' + encodeURIComponent(x.id), { method: 'POST', headers: { 'content-type': 'application/json' }, body: 文本 })
                            const j = await r.json()
                            set保存错('导入到 ' + (x.title || x.id.slice(0, 8)) + '：会话 ' + (j.导入会话 || 0) + ' 份，记忆 ' + (j.导入记忆 || 0) + ' 条')
                            刷新()
                          } catch (err) { set保存错('导入失败：' + ((err && err.message) || '原因不明')) }
                        },
                      })))
                )
              })
              : [h('div', { key: 'none', 'data-em-note': '' }, '没读到正在跑的会话')])),
          h('div', { 'data-em-note': '' }, 保存错)),

        h('div', { 'data-em-sec': '' },
          h('div', { 'data-em-h': '' }, '心情设置'),
          h('label', { 'data-em-row': '', style: { cursor: 'pointer' } },
            h('span', {}, '每轮注入心境'),
            h('input', { type: 'checkbox', checked: 配.注入 !== false, onChange: (e) => 存({ 注入: e.target.checked }) })),
          h('div', { 'data-em-h2': '' }, '基线'),
          h(数字, { 键: '基线P', 名: '基线 P（效价）', 值: 配.基线P, 存: 改, 说明: '没事的时候，效价往这里回；越大越容易觉得舒服' }),
          h(数字, { 键: '基线A', 名: '基线 A（唤醒）', 值: 配.基线A, 存: 改, 说明: '没事的时候，唤醒往这里回；负值表示偏安静' }),
          h(数字, { 键: '基线D', 名: '基线 D（掌控）', 值: 配.基线D, 存: 改, 说明: '没事的时候，掌控感往这里回；正=略占上风，负=略被动' }),
          h('div', { 'data-em-h2': '' }, '回落（每 5 分钟一轮的比例）'),
          h(数字, { 键: '弛豫P', 名: 'P 回落', 值: 配.弛豫P, 存: 改, 说明: '每 5 分钟向基线回落的比例；越大，情绪散得越快' }),
          h(数字, { 键: '弛豫A', 名: 'A 回落', 值: 配.弛豫A, 存: 改, 说明: '同上，作用于唤醒轴；唤醒本来就散得最快' }),
          h(数字, { 键: '弛豫D', 名: 'D 回落', 值: 配.弛豫D, 存: 改, 说明: '同上，作用于掌控轴' }),
          h(数字, { 键: '强度衰减', 名: '通道强度衰减', 值: 配.强度衰减, 存: 改, 说明: '每轮把 14 个通道的强度乘 (1−这个数)；越大越健忘' }),
          h(数字, { 键: '读出阈值', 名: '读出阈值', 值: 配.读出阈值, 存: 改, 说明: '通道强度超过它才算进"成分"；调低更容易出现混合情绪' }),
          h('div', { 'data-em-h2': '' }, '精力'),
          h(数字, { 键: '精力初值', 名: '新会话起始精力', 值: 配.精力初值, 步: 1, 存: 改, 说明: '新会话第一次出现时有多少精力' }),
          h(数字, { 键: '精力每小时掉', 名: '醒着每小时 −', 值: 配.精力每小时掉, 步: 1, 存: 改, 说明: '醒着时每小时扣多少；越大越容易累' }),
          h(数字, { 键: '睡眠回复', 名: '跨夜睡一觉 +', 值: 配.睡眠回复, 步: 1, 存: 改, 说明: '跨过凌晨且间隔够久，算睡一觉，回多少' }),
          h(数字, { 键: '每轮扣', 名: '每聊一轮 −', 值: 配.每轮扣, 步: 1, 存: 改, 说明: '每聊一轮额外扣多少；和"每小时掉"叠加' })),
        h('div', { 'data-em-sec': '' },
          h('div', { 'data-em-h': '' }, '记忆设置'),
          h('label', { 'data-em-row': '', style: { cursor: 'pointer' } },
            h('span', {}, '按关键词想起旧记忆'),
            h('input', { type: 'checkbox', checked: 配.记忆注入 !== false, onChange: (e) => 存({ 记忆注入: e.target.checked }) })),
          h(数字, { 键: '记忆门槛', 名: '命中门槛', 值: 配.记忆门槛, 存: 改, 说明: '检索分低于它就不注入；调低更爱想起，但容易想起不相干' }),
          h(数字, { 键: '一次想起几条', 名: '一次想起几条（1–5）', 值: 配.一次想起几条, 步: 1, 存: 改, 说明: '一轮最多注入几条记忆，上限 5' }),
          h(数字, { 键: '重复间隔分钟', 名: '同一条多久内不重复（分钟）', 值: 配.重复间隔分钟, 步: 1, 存: 改, 说明: '同一条记忆在这个时间内不重复想起' }),
          h(数字, { 键: '每天记忆上限', 名: '每天最多想起（0 = 不限）', 值: 配.每天记忆上限, 步: 1, 存: 改, 说明: '一天最多想起几次；0 = 不限' }),
          h(数字, { 键: '半衰期天', 名: '新鲜度半衰期（天）', 值: 配.半衰期天, 步: 1, 存: 改, 说明: '新鲜度多久掉一半；越大越偏爱旧记忆' }),
          h('div', { 'data-em-h2': '' }, '检索打分权重'),
          h('div', { 'data-em-note': '' }, '四个权重决定"想起谁"。调大相关 = 只认字面对得上；调大新鲜 = 偏爱最近；调大重要 = 老账本优先。'),
          h(数字, { 键: '权重新鲜', 名: '新鲜', 值: 配.权重新鲜, 存: 改, 说明: '越近的越值钱（配合上面的半衰期）' }),
          h(数字, { 键: '权重重要', 名: '重要', 值: 配.权重重要, 存: 改, 说明: '写入时定的重要度' }),
          h(数字, { 键: '权重相关', 名: '相关', 值: 配.权重相关, 存: 改, 说明: '字面重合度；调低就会想起不相干的' }),
          h(数字, { 键: '权重心境', 名: '心境一致', 值: 配.权重心境, 存: 改, 说明: '编码时的心情和现在像不像' }),
          h(数字, { 键: '访问加成', 名: '访问加成', 值: 配.访问加成, 存: 改, 说明: '每被想起一次，重要度临时加多少（不改存量值）' }),
          h(数字, { 键: '遗忘天数', 名: '多久没想起算老（天）', 值: 配.遗忘天数, 步: 10, 存: 改, 说明: '超过这么多天、又没被想起的，进入"已遗忘"' }),
          h(数字, { 键: '遗忘重要阈值', 名: '重要度高于此不忘', 值: 配.遗忘重要阈值, 步: 0.1, 存: 改, 说明: '重要度高于它的不遗忘' }),
          h(数字, { 键: '派生阈值', 名: '派生情绪注入阈值', 值: 配.派生阈值, 步: 0.05, 存: 改, 说明: '派生情绪（委屈/吃醋等）超过它才在注入里补一句' })))
    }

    function Panel() {
      const [st, setSt] = React.useState(null)
      const [页, set页] = React.useState('mood')
      const [会话, set会话] = React.useState('')
      const [列表, set列表] = React.useState([])

      React.useEffect(() => {
        取('/sessions').then((j) => {
          const 条 = j.条 || []
          set列表(条)
          set会话((旧) => 旧 || (条[0] && 条[0].id) || '')
        }).catch(() => {})
      }, [])

      React.useEffect(() => {
        if (!会话) return
        let 活 = true
        const 跑 = () => 取('/state?session=' + encodeURIComponent(会话)).then((j) => { if (活) setSt(j) }).catch(() => {})
        跑()
        const t = setInterval(跑, 15000)
        return () => { 活 = false; clearInterval(t) }
      }, [会话])

      const 刷新 = () => { if (会话) 取('/state?session=' + encodeURIComponent(会话)).then(setSt).catch(() => {}) }
      const 页签 = [['mood', '心情'], ['mem', '记忆'], ['log', '记录'], ['cfg', '设置']]
      const 绑定模式 = st && st.配置 && st.配置.绑定模式
      const 绑定列表 = (st && st.绑定列表) || []
      // 绑定了但一个都没勾时，仍然列全部 —— 否则下拉空、三个页签全空白
      const 可看 = 绑定模式 === '指定' && 绑定列表.length
        ? 列表.filter((x) => 绑定列表.includes(x.id))
        : 列表
      // 会话不在可看范围里就切到第一个
      React.useEffect(() => {
        if (!可看.length) return
        if (!可看.some((x) => x.id === 会话)) set会话(可看[0].id)
      }, [可看.map((x) => x.id).join(','), 会话])
      const 当前 = 列表.find((x) => x.id === 会话) || {}
      const 当前名 = 当前.title || (会话 ? 会话.slice(0, 8) : '（没有会话）')

      return h('div', { 'data-em-wrap': '' },
        h('div', { 'data-em-topbar': '' },
          h('div', { 'data-em-tabs': '' }, 页签.map((x) =>
            h('button', { key: x[0], 'data-em-tab': '', 'data-on': 页 === x[0] ? '' : undefined, onClick: () => set页(x[0]) }, x[1]))),
          h('select', {
            'data-em-input': '', style: { width: 220 }, value: 会话,
            onChange: (e) => set会话(e.target.value),
          },
            ...可看.map((x) => h('option', { key: x.id, value: x.id }, (x.title || x.id.slice(0, 8)) + (x.id === (st && st.key) ? '（当前）' : '')))),
          h('span', { 'data-em-note': '' }, '正在看：' + 当前名)),
        页 === 'mood' ? h(心情页, { st: st, 会话: 会话 }) : null,
        页 === 'mem' ? h(记忆页, { 会话: 会话 }) : null,
        页 === 'log' ? h(记录页, { 会话: 会话 }) : null,
        页 === 'cfg' ? h(设置页, { st: st, 刷新: 刷新, 会话: 会话 }) : null)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-emotion-memory')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-emotion-memory: css')
        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'emotion-memory', order: 41, label: '情绪记忆' },
          () => h(Panel),
        ))
      },
    }
  },
})
