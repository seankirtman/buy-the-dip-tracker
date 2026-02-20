'use client';

import { useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import {
  createChart,
  createSeriesMarkers,
  AreaSeries,
  HistogramSeries,
  ColorType,
  TickMarkType,
} from 'lightweight-charts';
import type {
  IChartApi,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  SeriesMarkerBar,
  Time,
  AreaData,
  HistogramData,
} from 'lightweight-charts';
import { format, parse } from 'date-fns';
import type { OHLCDataPoint } from '@/lib/types/stock';
import type { StockEvent } from '@/lib/types/event';
import type { TimePeriod } from '@/lib/types/stock';

export interface ChartContainerHandle {
  zoomToEvent: (eventDate: string) => void;
  resetZoom: () => void;
}

interface ChartContainerProps {
  data: OHLCDataPoint[];
  events: StockEvent[];
  showEvents: boolean;
  selectedEventId: string | null;
  timePeriod?: TimePeriod;
  onEventClick?: (eventId: string) => void;
}

function formatTickLabel(time: Time, tickMarkType: TickMarkType, period?: TimePeriod): string {
  if (typeof time === 'number') {
    const d = new Date(time * 1000);
    if (period === '1D') return format(d, 'HH:mm');
    return format(d, 'MMM d');
  }

  const str = typeof time === 'string' ? time : '';
  if (!str || str.length < 10) return str;
  try {
    const hasTime = str.includes(' ');
    const d = hasTime
      ? parse(str, 'yyyy-MM-dd HH:mm:ss', new Date())
      : parse(str.slice(0, 10), 'yyyy-MM-dd', new Date());
    // Short periods: show day of week + date for clarity
    if (period === '1D') {
      return hasTime ? format(d, 'HH:mm') : format(d, 'EEE M/d');
    }
    if (period === '7D') {
      return format(d, 'EEE M/d');
    }
    if (period === '1M') {
      return format(d, 'EEE M/d');
    }
    // Longer periods: month + day
    return format(d, 'MMM d');
  } catch {
    return str;
  }
}

function toChartTime(value: string): Time {
  // Intraday payload format: YYYY-MM-DD HH:mm:ss
  if (value.includes(' ')) {
    const d = parse(value, 'yyyy-MM-dd HH:mm:ss', new Date());
    return Math.floor(d.getTime() / 1000) as Time;
  }
  return value as Time;
}

export const ChartContainer = forwardRef<ChartContainerHandle, ChartContainerProps>(
  function ChartContainer({ data, events, showEvents, selectedEventId, timePeriod, onEventClick }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);
    const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
    const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

    // Expose imperative methods
    useImperativeHandle(ref, () => ({
      zoomToEvent(eventDate: string) {
        if (!chartRef.current || !data.length) return;
        const idx = data.findIndex((d) => d.time === eventDate);
        if (idx === -1) return;

        const from = Math.max(0, idx - 30);
        const to = Math.min(data.length - 1, idx + 30);
        chartRef.current.timeScale().setVisibleRange({
          from: data[from].time as Time,
          to: data[to].time as Time,
        });
      },
      resetZoom() {
        if (chartRef.current) {
          chartRef.current.timeScale().fitContent();
        }
      },
    }));

    // Create chart once
    useEffect(() => {
      if (!containerRef.current) return;

      const chart = createChart(containerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: '#94a3b8',
          fontFamily: "var(--font-inter, sans-serif)",
        },
        grid: {
          vertLines: { color: 'rgba(30, 41, 59, 0.3)', style: 2 },
          horzLines: { color: 'rgba(30, 41, 59, 0.3)', style: 2 },
        },
        width: containerRef.current.clientWidth,
        height: 500,
        timeScale: {
          borderColor: 'rgba(51, 65, 85, 0.4)',
          timeVisible: timePeriod === '1D',
          secondsVisible: false,
          minBarSpacing: 3,
          barSpacing: 6,
          rightOffset: 0,
          fixLeftEdge: true,
          fixRightEdge: true,
          tickMarkFormatter: (time: Time, tickMarkType: TickMarkType) =>
            formatTickLabel(time, tickMarkType, timePeriod),
        },
        rightPriceScale: {
          borderColor: 'rgba(51, 65, 85, 0.4)',
        },
        crosshair: {
          mode: 1, // Magnet
          vertLine: {
            width: 1,
            color: 'rgba(148, 163, 184, 0.4)',
            style: 3,
            labelBackgroundColor: '#0f1729',
          },
          horzLine: {
            width: 1,
            color: 'rgba(148, 163, 184, 0.4)',
            style: 3,
            labelBackgroundColor: '#0f1729',
          },
        },
        handleScroll: {
          vertTouchDrag: false,
        },
        kineticScroll: {
          touch: true,
          mouse: true,
        },
      });

      const series = chart.addSeries(AreaSeries, {
        lineColor: '#22c55e',
        topColor: 'rgba(34, 197, 94, 0.4)',
        bottomColor: 'rgba(34, 197, 94, 0.0)',
        lineWidth: 2,
      });

      const volume = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });

      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });

      // Create markers plugin (v5 API)
      const markers = createSeriesMarkers(series, []);
      markersRef.current = markers;

      chartRef.current = chart;
      seriesRef.current = series;
      volumeRef.current = volume;

      // Resize observer: update width and re-fit so chart always fills container
      const ro = new ResizeObserver((entries) => {
        chart.applyOptions({ width: entries[0].contentRect.width });
        chart.timeScale().fitContent();
      });
      ro.observe(containerRef.current);

      return () => {
        ro.disconnect();
        chart.remove();
        chartRef.current = null;
        seriesRef.current = null;
        volumeRef.current = null;
        markersRef.current = null;
      };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Update tick labels when time period changes
    useEffect(() => {
      if (!chartRef.current) return;
      chartRef.current.applyOptions({
        timeScale: {
          timeVisible: timePeriod === '1D',
          secondsVisible: false,
          tickMarkFormatter: (time: Time, tickMarkType: TickMarkType) =>
            formatTickLabel(time, tickMarkType, timePeriod),
        },
      });
    }, [timePeriod]);

    // Update chart data
    useEffect(() => {
      if (!seriesRef.current || !volumeRef.current || !data.length) return;

      const areaData: AreaData[] = data.map((d) => ({
        time: toChartTime(d.time),
        value: d.close,
      }));

      const volumeData: HistogramData[] = data.map((d) => ({
        time: toChartTime(d.time),
        value: d.volume,
        color: d.close >= d.open ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)',
      }));

      seriesRef.current.setData(areaData);
      volumeRef.current.setData(volumeData);
      chartRef.current?.timeScale().fitContent();
    }, [data]);

    // Update event markers
    const updateMarkers = useCallback(() => {
      if (!markersRef.current) return;

      if (!showEvents || events.length === 0 || data.length === 0) {
        markersRef.current.setMarkers([]);
        return;
      }

      // Only show markers for events that fall within the currently displayed timeframe data.
      const visibleDates = new Set(data.map((d) => d.time.slice(0, 10)));

      // Only show top 15 events on chart
      const topEvents = [...events]
        .filter((event) => visibleDates.has(event.date))
        .sort((a, b) => b.impactScore - a.impactScore)
        .slice(0, 15)
        .sort((a, b) => a.date.localeCompare(b.date));

      const markers: SeriesMarkerBar<Time>[] = topEvents.map((event) => ({
        time: event.date as Time,
        position: (event.impact.direction === 'negative' ? 'aboveBar' : 'belowBar') as SeriesMarkerBar<Time>['position'],
        color:
          event.impact.magnitude === 'extreme'
            ? '#f97316'
            : event.impact.magnitude === 'high'
              ? '#eab308'
              : '#6366f1',
        shape: event.impact.direction === 'negative' ? 'arrowDown' : 'arrowUp',
        text: event.title.length > 20 ? event.title.slice(0, 20) + '...' : event.title,
        size: event.impact.magnitude === 'extreme' ? 3 : event.impact.magnitude === 'high' ? 2 : 1,
      }));

      markersRef.current.setMarkers(markers);
    }, [events, showEvents, data]);

    useEffect(() => {
      updateMarkers();
    }, [updateMarkers]);

    // Zoom to selected event
    useEffect(() => {
      if (selectedEventId && chartRef.current) {
        const event = events.find((e) => e.id === selectedEventId);
        if (event) {
          const idx = data.findIndex((d) => d.time === event.date);
          if (idx >= 0) {
            const from = Math.max(0, idx - 30);
            const to = Math.min(data.length - 1, idx + 30);
            chartRef.current.timeScale().setVisibleRange({
              from: data[from].time as Time,
              to: data[to].time as Time,
            });
          }
        }
      }
    }, [selectedEventId, events, data]);

    // Handle click on chart for event selection
    useEffect(() => {
      if (!chartRef.current || !onEventClick || !showEvents) return;

      const chart = chartRef.current;
      const handler = (param: { time?: Time }) => {
        if (!param.time) return;
        const timeStr = param.time as string;
        const matchingEvent = events.find((e) => e.date === timeStr);
        if (matchingEvent) {
          onEventClick(matchingEvent.id);
        }
      };

      chart.subscribeClick(handler);
      return () => chart.unsubscribeClick(handler);
    }, [events, showEvents, onEventClick]);

    return (
      <div
        ref={containerRef}
        className="w-full overflow-hidden rounded-xl border border-border/50 bg-gradient-to-b from-bg-secondary/30 to-bg-primary shadow-sm backdrop-blur-sm"
      />
    );
  }
);
