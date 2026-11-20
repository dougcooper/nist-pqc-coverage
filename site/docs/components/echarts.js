import * as echarts from "npm:echarts@5.5";

/** Evidence's qualitative palette, which also matches the site accent. */
export const palette = [
  "#4e79a7",
  "#f28e2b",
  "#e15759",
  "#76b7b2",
  "#59a14f",
  "#edc948",
  "#b07aa1",
  "#ff9da7",
  "#9c755f",
  "#bab0ac"
];

const integer = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", {notation: "compact"});

function theme() {
  const style = getComputedStyle(document.documentElement);
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  return {
    dark,
    fg: read("--theme-foreground", dark ? "#e6e6e6" : "#1b1b1b"),
    muted: read("--theme-foreground-muted", dark ? "#a0a0a0" : "#6b6b6b"),
    grid: read("--theme-foreground-faintest", dark ? "#2f2f2f" : "#e8e8e8"),
    panel: read("--theme-background-alt", dark ? "#232323" : "#f7f7f7")
  };
}

function baseOption(t) {
  return {
    animationDuration: 350,
    textStyle: {
      fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
      color: t.fg,
      fontSize: 12
    },
    tooltip: {
      trigger: "item",
      backgroundColor: t.panel,
      borderColor: t.grid,
      borderWidth: 1,
      padding: [6, 10],
      textStyle: {color: t.fg, fontSize: 12},
      extraCssText: "border-radius:6px;box-shadow:0 6px 16px rgba(0,0,0,0.12)"
    }
  };
}

function axisLabel(t) {
  return {color: t.muted, fontSize: 11};
}

function valueAxis(t, {label, format = compact} = {}) {
  return {
    type: "value",
    name: label,
    nameTextStyle: {color: t.muted, fontSize: 11, align: "left"},
    splitLine: {lineStyle: {color: t.grid, width: 1}},
    axisLine: {show: false},
    axisTick: {show: false},
    axisLabel: {...axisLabel(t), formatter: format}
  };
}

function categoryAxis(t, {data, inverse = false, rotate = 0, truncate} = {}) {
  const label = {...axisLabel(t), interval: 0, hideOverlap: true, rotate};
  if (truncate) {
    label.formatter = (value) =>
      value.length > truncate ? `${value.slice(0, truncate - 1)}\u2026` : value;
  }
  return {
    type: "category",
    data,
    inverse,
    axisLine: {show: false},
    axisTick: {show: false},
    axisLabel: label
  };
}

function colorOf(colors, key, index) {
  if (typeof colors === "function") return colors(key, index);
  if (colors instanceof Map) return colors.get(key) ?? palette[index % palette.length];
  return colors?.[index % colors.length] ?? palette[index % palette.length];
}

/** Draw a factory-built option into a resizing, theme-aware container. */
export function chart(factory, {height = 260} = {}) {
  const el = document.createElement("div");
  el.className = "chart";
  el.style.height = `${height}px`;
  el.style.width = "100%";

  let instance = null;

  function draw() {
    if (!el.clientWidth) return;
    const option = factory(theme());
    if (!instance) {
      instance = echarts.init(el, null, {renderer: "canvas"});
      instance.setOption(option);
    } else {
      instance.dispose();
      instance = echarts.init(el, null, {renderer: "canvas"});
      instance.setOption(option);
    }
  }

  const observer = new ResizeObserver(() => {
    if (!instance) draw();
    else instance.resize();
  });
  observer.observe(el);

  const media = matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", () => {
    if (instance) instance.dispose();
    instance = null;
    draw();
  });

  return el;
}

/**
 * Bar chart. `series` turns rows into one bar per series value (stacked only
 * when `stack` is true); without it the rows are categories of one series.
 */
export function barChart(
  rows,
  {
    x,
    y,
    series,
    horizontal = false,
    stack = false,
    colorBy,
    colors = palette,
    height = 260,
    labels = false,
    labelFormat,
    valueLabel,
    rotate = 0,
    truncate
  } = {}
) {
  return chart((t) => {
    const categories = [...new Set(rows.map((row) => row[x]))];
    const groups = new Map();
    for (const row of rows) {
      const key = series ? row[series] : null;
      if (!groups.has(key)) groups.set(key, new Map());
      groups.get(key).set(row[x], row[y]);
    }
    const barSeries = [...groups].map(([key, values], index) => ({
      name: series ? key : (valueLabel ?? y),
      type: "bar",
      stack: stack ? "total" : undefined,
      barMaxWidth: 34,
      data: categories.map((category) => {
        const value = values.get(category) ?? 0;
        if (!colorBy || series) return value;
        return {
          value,
          itemStyle: {
            color: colorOf(colors, category, index),
            borderRadius: horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]
          }
        };
      }),
      itemStyle: {
        color: colorOf(colors, key, index),
        borderRadius: horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]
      },
      label: labels
        ? {
            show: true,
            position: horizontal ? "right" : "top",
            color: t.muted,
            fontSize: 10,
            formatter: ({value, dataIndex}) =>
              labelFormat
                ? labelFormat(value, categories[dataIndex])
                : compact.format(value)
          }
        : undefined
    }));

    const valueAx = valueAxis(t, {format: (value) => compact.format(value)});
    const categoryAx = categoryAxis(t, {data: categories, rotate, truncate});
    return {
      ...baseOption(t),
      grid: {left: 8, right: labels && horizontal ? 130 : 24, top: series ? 34 : 12, bottom: 8, containLabel: true},
      legend: series
        ? {
            top: 0,
            left: 0,
            itemWidth: 10,
            itemHeight: 10,
            icon: "roundRect",
            textStyle: {color: t.muted, fontSize: 11}
          }
        : undefined,
      tooltip: {...baseOption(t).tooltip, trigger: "axis", axisPointer: {type: "shadow"}},
      xAxis: horizontal ? valueAx : categoryAx,
      yAxis: horizontal ? {...categoryAx, inverse: true} : valueAx,
      series: barSeries
    };
  }, {height});
}

/** Line chart; `series` is a list of {key, label?, color?} value fields. */
export function lineChart(
  rows,
  {
    x,
    series,
    height = 280,
    area = false,
    percent = false,
    yLabel,
    rule,
    labels = false,
    xNumeric = false
  } = {}
) {
  return chart((t) => {
    const format = percent ? (value) => `${value}%` : (value) => compact.format(value);
    return {
      ...baseOption(t),
      grid: {left: 8, right: 24, top: 34, bottom: 8, containLabel: true},
      legend: {
        top: 0,
        left: 0,
        itemWidth: 14,
        itemHeight: 8,
        icon: "roundRect",
        textStyle: {color: t.muted, fontSize: 11}
      },
      tooltip: {
        ...baseOption(t).tooltip,
        trigger: "axis",
        valueFormatter: (value) => (percent ? `${value}%` : integer.format(value))
      },
      xAxis: xNumeric
        ? {...valueAxis(t, {label: "rank"}), min: 1, max: rows.length}
        : {
            ...categoryAxis(t, {data: rows.map((row) => row[x])}),
            boundaryGap: false
          },
      yAxis: valueAxis(t, {label: yLabel, format}),
      series: series.map((item, index) => ({
        name: item.label ?? item.key,
        type: "line",
        data: rows.map((row) => (xNumeric ? [row[x], row[item.key]] : row[item.key])),
        symbol: "circle",
        symbolSize: 4,
        showSymbol: labels || rows.length <= 24,
        lineStyle: {width: 2},
        itemStyle: {color: item.color ?? palette[index % palette.length]},
        areaStyle: area
          ? {color: item.color ?? palette[index % palette.length], opacity: 0.12}
          : undefined,
        markLine:
          rule && index === 0
            ? {
                silent: true,
                symbol: "none",
                lineStyle: {color: t.muted, type: "dashed", width: 1},
                label: {color: t.muted, fontSize: 10, formatter: rule.label},
                data: [{yAxis: rule.value}]
              }
            : undefined
      }))
    };
  }, {height});
}

/**
 * Heatmap of value at (x, y). Colours are mixed in JS so each cell can choose
 * a label colour that stays readable on light and dark cells.
 */
export function heatmap(
  rows,
  {
    x,
    y,
    value,
    height = 340,
    colors = ["#f0f7ff", "#08306b"],
    format = integer.format,
    label = (v) => (v ? format(v) : "")
  } = {}
) {
  return chart((t) => {
    const xs = [...new Set(rows.map((row) => row[x]))];
    const ys = [...new Set(rows.map((row) => row[y]))];
    const xIndex = new Map(xs.map((key, index) => [key, index]));
    const yIndex = new Map(ys.map((key, index) => [key, index]));
    const max = Math.max(1, ...rows.map((row) => row[value]));

    const cells = rows.map((row) => {
      const weight = Math.pow(row[value] / max, 0.6);
      return {
        value: [xIndex.get(row[x]), yIndex.get(row[y]), row[value]],
        itemStyle: {color: mix(colors[0], colors[1], weight)},
        label: {color: weight > 0.45 ? "#fff" : "#1b1b1b"}
      };
    });

    return {
      ...baseOption(t),
      grid: {left: 8, right: 16, top: 8, bottom: 8, containLabel: true},
      tooltip: {
        ...baseOption(t).tooltip,
        formatter: ({value: cell}) =>
          `${ys[cell[1]]} \u00b7 ${xs[cell[0]]}<br><strong>${format(cell[2])}</strong> products`
      },
      xAxis: categoryAxis(t, {data: xs}),
      yAxis: categoryAxis(t, {data: ys, inverse: true}),
      series: [
        {
          type: "heatmap",
          data: cells,
          itemStyle: {borderColor: t.panel, borderWidth: 1.5},
          label: {
            show: true,
            fontSize: 10,
            formatter: ({value: cell}) => label(cell[2])
          },
          emphasis: {itemStyle: {shadowBlur: 6, shadowColor: "rgba(0,0,0,0.3)"}}
        }
      ]
    };
  }, {height});
}

/** Linear mix of two #rrggbb colours. */
function mix(from, to, weight) {
  const parse = (hex) => {
    const value = hex.replace("#", "");
    return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
  };
  const a = parse(from);
  const b = parse(to);
  const channel = (i) => Math.round(a[i] + (b[i] - a[i]) * weight);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}
