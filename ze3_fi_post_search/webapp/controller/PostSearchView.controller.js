sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageBox",
    "sap/ui/export/Spreadsheet",
  ],
  function (
    Controller,
    JSONModel,
    Filter,
    FilterOperator,
    MessageBox,
    Spreadsheet,
  ) {
    "use strict";

    const PAGE_SIZE = 7;

    const BLART_KOR = {
      SA: "일반전표",
      AB: "역분개전표",
      KR: "매입전표",
      KZ: "지급전표",
      DR: "매출전표",
      DZ: "입금전표",
      WA: "출고전표",
      WE: "입고전표",
      RE: "송장전표",
      PR: "정산",
      AA: "고정자산",
    };

    return Controller.extend(
      "ze3.fi.post.search.ze3fipostsearch.controller.PostSearchView",
      {
        onInit() {
          const oVM = new JSONModel({
            busy: false,
            hasData: false,
            hasItems: false,
            infoText: "",
            totalCount: 0,
            page: 1,
            pageCount: 1,
            pageData: [],
            headers: [],
            items: [],
            selectedBelnr: "",
            selectedBltxt: "",
            kpi: { total: "0", normal: "0", open: "0", cancelled: "0", arCount: "0", apCount: "0", arOpen: "0", apOpen: "0" },
            detailBusy: false,
            itemCount: "0",
            blartSummary: [],
            waersSummary: [],
            blartList: [],
            belnrList: [],
            filters: {
              Gjahr: new Date().getFullYear().toString(),
              Blart: "",
              Belnr: "",
            },
            agingDrill: {
              title: "",
              subtitle: "",
              stripType: "Warning",
              items: [],
            },
          });
          this.getView().setModel(oVM, "view");
          this._initialSearchDone = false;
        },

        onAfterRendering() {
          if (!this._initialSearchDone) {
            this._initialSearchDone = true;
            this.onSearch();
          }
        },

        // ── 조회 ──────────────────────────────────────────────────────
        onSearch() {
          const oVM = this.getView().getModel("view");
          oVM.setProperty("/busy", true);
          oVM.setProperty("/page", 1);
          oVM.setProperty("/hasItems", false);
          oVM.setProperty("/items", []);
          oVM.setProperty("/selectedBelnr", "");
          oVM.setProperty("/selectedBltxt", "");

          const filters = this._buildFilters();
          this.getView()
            .getModel()
            .read("/ZCDS_E3_FI_0007", {
              filters: filters,
              success: (oData) => {
                this._allHeaders = this._processHeaders(oData.results || []);
                this._applyDateFilter();
                oVM.setProperty("/busy", false);
              },
              error: (oErr) => {
                oVM.setProperty("/busy", false);
                let msg = null;
                try {
                  msg = JSON.parse(oErr.responseText)?.error?.message?.value;
                } catch (e) {
                  /* ignore */
                }
                MessageBox.error(
                  msg || "전표 헤더 조회 중 오류가 발생했습니다.",
                );
              },
            });
        },

        // Budat는 서버에서 필터 미지원 → 클라이언트에서 처리
        _buildFilters() {
          const oVM = this.getView().getModel("view");
          const f = oVM.getProperty("/filters");
          const filters = [];
          if (f.Gjahr)
            filters.push(new Filter("Gjahr", FilterOperator.EQ, f.Gjahr));
          if (f.Blart)
            filters.push(new Filter("Blart", FilterOperator.EQ, f.Blart));
          if (f.Belnr)
            filters.push(new Filter("Belnr", FilterOperator.EQ, f.Belnr));
          return filters;
        },

        _applyDateFilter() {
          const oVM = this.getView().getModel("view");
          const sFrom = this.byId("idBudatFrom")?.getValue() || "";
          const sTo = this.byId("idBudatTo")?.getValue() || "";

          let results = this._allHeaders || [];

          if (sFrom && sFrom.length === 8) {
            const dFrom = new Date(
              Date.UTC(
                +sFrom.slice(0, 4),
                +sFrom.slice(4, 6) - 1,
                +sFrom.slice(6, 8),
              ),
            );
            results = results.filter((r) => {
              const d = this._toDate(r.Budat);
              return d && d >= dFrom;
            });
          }
          if (sTo && sTo.length === 8) {
            const dTo = new Date(
              Date.UTC(
                +sTo.slice(0, 4),
                +sTo.slice(4, 6) - 1,
                +sTo.slice(6, 8),
                23,
                59,
                59,
              ),
            );
            results = results.filter((r) => {
              const d = this._toDate(r.Budat);
              return d && d <= dTo;
            });
          }

          oVM.setProperty("/headers", results);
          oVM.setProperty("/totalCount", results.length);
          oVM.setProperty("/hasData", results.length > 0);
          oVM.setProperty(
            "/infoText",
            results.length > 0
              ? `총 ${results.length.toLocaleString("ko-KR")}건 조회되었습니다.`
              : "조회 결과가 없습니다.",
          );
          this._computeStats(results);
          this._buildCharts(results);
          this._updatePagination();
        },

        _toDate(val) {
          if (!val) return null;
          if (val instanceof Date) return val;
          const m = String(val).match(/\/Date\((-?\d+)\)\//);
          return m ? new Date(parseInt(m[1], 10)) : null;
        },

        // ── KPI + 분포 통계 ────────────────────────────────────────────
        _computeStats(aResults) {
          const oVM = this.getView().getModel("view");
          const fmt = (n) => n.toLocaleString("ko-KR");
          const normal = aResults.filter(
            (r) => !r.Bstat || r.Bstat.trim() === "",
          ).length;
          const open = aResults.filter((r) => r.OpenFlag === "X").length;
          const cancelled = aResults.filter((r) => r.Bstat === "A").length;

          // AR(매출채권): DR=매출, DZ=입금 / AP(매입채무): KR=매입, KZ=지급, RE=송장
          const AR_TYPES = new Set(["DR", "DZ"]);
          const AP_TYPES = new Set(["KR", "KZ", "RE"]);
          const arCount  = aResults.filter((r) => AR_TYPES.has((r.Blart || "").trim())).length;
          const apCount  = aResults.filter((r) => AP_TYPES.has((r.Blart || "").trim())).length;
          const arOpen   = aResults.filter((r) => r.OpenFlag === "X" && AR_TYPES.has((r.Blart || "").trim())).length;
          const apOpen   = aResults.filter((r) => r.OpenFlag === "X" && AP_TYPES.has((r.Blart || "").trim())).length;

          oVM.setProperty("/kpi", {
            total: fmt(aResults.length),
            normal: fmt(normal),
            open: fmt(open),
            cancelled: fmt(cancelled),
            arCount: fmt(arCount),
            apCount: fmt(apCount),
            arOpen: fmt(arOpen),
            apOpen: fmt(apOpen),
          });

          const toArr = (map, addKor) =>
            Object.entries(map)
              .map(([key, count]) => ({
                key,
                count,
                kor: addKor ? BLART_KOR[key] || "" : "",
              }))
              .sort((a, b) => b.count - a.count);

          const blartMap = {},
            waersMap = {};
          aResults.forEach((r) => {
            const b = r.Blart?.trim() || "(없음)";
            const w = r.Waers?.trim() || "(없음)";
            blartMap[b] = (blartMap[b] || 0) + 1;
            waersMap[w] = (waersMap[w] || 0) + 1;
          });
          oVM.setProperty("/blartSummary", toArr(blartMap, true));
          oVM.setProperty("/waersSummary", toArr(waersMap, false));
        },

        // ── 차트 빌드 ─────────────────────────────────────────────────
        _buildCharts(aResults) {
          this._buildMonthlyChart(aResults);
          this._buildBlartChart(aResults);
          this._buildStatusChart(aResults);
          this._buildAgingChart(aResults);
        },

        _buildAgingChart(aResults) {
          const oViz = this.byId("idAgingChart");
          if (!oViz) return;

          const today = Date.now();
          const MS_DAY = 86400000;
          const AR_TYPES = new Set(["DR", "DZ"]);
          const AP_TYPES = new Set(["KR", "KZ", "RE"]);
          const buckets = [
            { Age: "7일 미만",  min: 0,  max: 7,        AR: 0, AP: 0, 기타: 0 },
            { Age: "7~30일",   min: 7,  max: 30,       AR: 0, AP: 0, 기타: 0 },
            { Age: "30~90일",  min: 30, max: 90,       AR: 0, AP: 0, 기타: 0 },
            { Age: "90일 이상", min: 90, max: Infinity, AR: 0, AP: 0, 기타: 0 },
          ];
          aResults
            .filter((r) => r.OpenFlag === "X")
            .forEach((r) => {
              const d = this._toDate(r.Budat);
              if (!d) return;
              const days = Math.max(0, Math.floor((today - d.getTime()) / MS_DAY));
              const b = buckets.find((x) => days >= x.min && days < x.max);
              if (!b) return;
              const blart = (r.Blart || "").trim();
              if (AR_TYPES.has(blart)) b.AR++;
              else if (AP_TYPES.has(blart)) b.AP++;
              else b.기타++;
            });
          const aData = buckets.map((b) => ({
            Age: b.Age,
            "매출채권(AR)": b.AR,
            "매입채무(AP)": b.AP,
            "기타": b.기타,
          }));

          sap.ui.require(
            [
              "sap/viz/ui5/data/FlattenedDataset",
              "sap/viz/ui5/controls/common/feeds/FeedItem",
            ],
            (FlattenedDataset, FeedItem) => {
              const oModel = this.getView().getModel("view");
              oViz.setModel(new oModel.constructor({ data: aData }));
              oViz.setVizType("stacked_column");
              oViz.setDataset(
                new FlattenedDataset({
                  dimensions: [{ name: "경과일", value: "{Age}" }],
                  measures: [
                    { name: "매출채권(AR)", value: "{매출채권(AR)}" },
                    { name: "매입채무(AP)", value: "{매입채무(AP)}" },
                    { name: "기타",        value: "{기타}" },
                  ],
                  data: { path: "/data" },
                }),
              );
              oViz.removeAllFeeds();
              oViz.addFeed(new FeedItem({ uid: "valueAxis",    type: "Measure",   values: ["매출채권(AR)", "매입채무(AP)", "기타"] }));
              oViz.addFeed(new FeedItem({ uid: "categoryAxis", type: "Dimension", values: ["경과일"] }));
              oViz.setVizProperties({
                title: { visible: false },
                legend: { visible: true, position: "bottom" },
                plotArea: {
                  colorPalette: ["#0070d2", "#bb0000", "#8d9cb0"],
                  dataLabel: { visible: true },
                },
                valueAxis: { title: { visible: false } },
                categoryAxis: { title: { visible: false } },
              });
            },
          );
        },

        _buildMonthlyChart(aResults) {
          const oViz = this.byId("idMonthlyChart");
          if (!oViz) return;

          const mMonth = {};
          aResults.forEach((r) => {
            const mon = String(r.Monat || "").padStart(2, "0");
            if (!mon || mon === "00") return;
            mMonth[mon] = (mMonth[mon] || 0) + 1;
          });
          const aData = Object.keys(mMonth)
            .sort()
            .map((k) => ({ Month: k + "월", Count: mMonth[k] }));

          // 전월 대비 델타
          const oStatus = this.byId("idMonthDeltaStatus");
          if (oStatus && aData.length >= 2) {
            const curr = aData[aData.length - 1].Count;
            const prev = aData[aData.length - 2].Count;
            const delta =
              prev > 0 ? Math.round(((curr - prev) / prev) * 100) : 0;
            oStatus.setText(
              "전월 대비 " + (delta >= 0 ? "+" : "") + delta + "%",
            );
            oStatus.setState(
              delta > 0 ? "Error" : delta < 0 ? "Success" : "None",
            );
          } else if (oStatus) {
            oStatus.setText("");
          }

          sap.ui.require(
            [
              "sap/viz/ui5/data/FlattenedDataset",
              "sap/viz/ui5/controls/common/feeds/FeedItem",
            ],
            (FlattenedDataset, FeedItem) => {
              const oModel = this.getView().getModel("view");
              oViz.setModel(new oModel.constructor({ data: aData }));
              oViz.setDataset(
                new FlattenedDataset({
                  dimensions: [{ name: "월", value: "{Month}" }],
                  measures: [{ name: "건수", value: "{Count}" }],
                  data: { path: "/data" },
                }),
              );
              oViz.removeAllFeeds();
              oViz.addFeed(
                new FeedItem({
                  uid: "valueAxis",
                  type: "Measure",
                  values: ["건수"],
                }),
              );
              oViz.addFeed(
                new FeedItem({
                  uid: "categoryAxis",
                  type: "Dimension",
                  values: ["월"],
                }),
              );
              oViz.setVizProperties({
                title: { visible: false },
                legend: { visible: false },
                plotArea: {
                  colorPalette: ["#0070d2"],
                  dataLabel: { visible: true },
                },
                valueAxis: { title: { visible: false } },
                categoryAxis: { title: { visible: false } },
              });
            },
          );
        },

        _buildBlartChart(aResults) {
          const oViz = this.byId("idBlartChart");
          if (!oViz) return;

          const mBlart = {};
          aResults.forEach((r) => {
            const b = (r.Blart || "").trim() || "(없음)";
            const kor = BLART_KOR[b] || b;
            const key = b + "  " + kor;
            mBlart[key] = (mBlart[key] || 0) + 1;
          });
          const aData = Object.entries(mBlart)
            .map(([k, v]) => ({ Type: k, Count: v }))
            .sort((a, b) => b.Count - a.Count)
            .slice(0, 10);

          sap.ui.require(
            [
              "sap/viz/ui5/data/FlattenedDataset",
              "sap/viz/ui5/controls/common/feeds/FeedItem",
            ],
            (FlattenedDataset, FeedItem) => {
              const oModel = this.getView().getModel("view");
              oViz.setModel(new oModel.constructor({ data: aData }));
              oViz.setDataset(
                new FlattenedDataset({
                  dimensions: [{ name: "전표유형", value: "{Type}" }],
                  measures: [{ name: "건수", value: "{Count}" }],
                  data: { path: "/data" },
                }),
              );
              oViz.removeAllFeeds();
              oViz.addFeed(
                new FeedItem({
                  uid: "size",
                  type: "Measure",
                  values: ["건수"],
                }),
              );
              oViz.addFeed(
                new FeedItem({
                  uid: "color",
                  type: "Dimension",
                  values: ["전표유형"],
                }),
              );
              oViz.setVizProperties({
                title: { visible: false },
                legend: {
                  visible: true,
                  position: "right",
                  label: { style: { fontSize: "12px" } },
                },
                plotArea: {
                  dataLabel: {
                    visible: true,
                    type: "percentage",
                    style: { fontSize: "11px", fontWeight: "bold" },
                  },
                },
                tooltip: { formatString: { "건수": "#,##0" } },
              });
            },
          );
        },

        _buildStatusChart(aResults) {
          const oViz = this.byId("idStatusChart");
          if (!oViz) return;

          const normal = aResults.filter(
            (r) => !r.Bstat || r.Bstat.trim() === "",
          ).length;
          const open = aResults.filter((r) => r.OpenFlag === "X").length;
          const cancelled = aResults.filter((r) => r.Bstat === "A").length;
          const aData = [
            { Status: "정상", Count: normal },
            { Status: "미결", Count: open },
            { Status: "역분개", Count: cancelled },
          ].filter((d) => d.Count > 0);

          sap.ui.require(
            [
              "sap/viz/ui5/data/FlattenedDataset",
              "sap/viz/ui5/controls/common/feeds/FeedItem",
            ],
            (FlattenedDataset, FeedItem) => {
              const oModel = this.getView().getModel("view");
              oViz.setModel(new oModel.constructor({ data: aData }));
              oViz.setDataset(
                new FlattenedDataset({
                  dimensions: [{ name: "상태", value: "{Status}" }],
                  measures: [{ name: "건수", value: "{Count}" }],
                  data: { path: "/data" },
                }),
              );
              oViz.removeAllFeeds();
              oViz.addFeed(
                new FeedItem({
                  uid: "size",
                  type: "Measure",
                  values: ["건수"],
                }),
              );
              oViz.addFeed(
                new FeedItem({
                  uid: "color",
                  type: "Dimension",
                  values: ["상태"],
                }),
              );
              oViz.setVizProperties({
                title: { visible: false },
                legend: { visible: true, position: "right" },
                plotArea: {
                  colorPalette: ["#107e3e", "#e76500", "#bb0000"],
                  dataLabel: { visible: true },
                },
              });
            },
          );
        },

        // ── 헤더 전처리 ────────────────────────────────────────────────
        _processHeaders(aResults) {
          const today = Date.now();
          const MS_DAY = 86400000;
          return aResults.map((r) => {
            const kunnr = r.Kunnr?.trim() || "";
            const lifnr = r.Lifnr?.trim() || "";
            const dBudat = this._toDate(r.Budat);
            const daysOut = r.OpenFlag === "X" && dBudat
              ? Math.max(0, Math.floor((today - dBudat.getTime()) / MS_DAY))
              : null;
            return {
              ...r,
              _Bldat: this._fmtDate(r.Bldat, true),
              _Budat: this._fmtDate(r.Budat, true),
              _Erdat: this._fmtDate(r.Erdat, false),
              _Kursf: this._fmtNum(r.Kursf, 0),
              _BlartKor: BLART_KOR[r.Blart?.trim()] || r.Blart || "",
              _BP: kunnr || lifnr || "",
              _BPType: kunnr ? "고객" : lifnr ? "공급업체" : "",
              _BstatText: this._bstatText(r.Bstat),
              _BstatState: this._bstatState(r.Bstat),
              _OpenText: r.OpenFlag === "X" ? "미결" : "완료",
              _OpenState: r.OpenFlag === "X" ? "Warning" : "Success",
              _DaysOut: daysOut,
              _ClearState: r.Bstat === "A" ? "Error" : r.OpenFlag === "X" ? "Warning" : "Success",
              _ClearText:  r.Bstat === "A" ? "역분개" : r.OpenFlag === "X" ? "미결" : "반제",
              __selected: false,
            };
          });
        },

        _bstatText(s) {
          if (!s || s.trim() === "") return "정상";
          if (s === "A") return "역전됨";
          if (s === "V") return "임시저장";
          if (s === "B") return "계획";
          return s;
        },
        _bstatState(s) {
          if (!s || s.trim() === "") return "Success";
          if (s === "A") return "Error";
          return "Warning";
        },

        // ── 연령 분석 드릴다운 ─────────────────────────────────────────
        onAgingSelect(oEvent) {
          const oEvtData = oEvent.getParameter("data");
          const oFirst = oEvtData && oEvtData.data && oEvtData.data[0];
          if (!oFirst) return;

          const sBucket = oFirst.data && oFirst.data["경과일"];
          if (!sBucket) return;

          const RANGES = {
            "7일 미만":  { min: 0,  max: 7,        strip: "Information" },
            "7~30일":   { min: 7,  max: 30,       strip: "Information" },
            "30~90일":  { min: 30, max: 90,       strip: "Warning" },
            "90일 이상": { min: 90, max: Infinity, strip: "Error" },
          };
          const range = RANGES[sBucket];
          if (!range) return;

          const aAllHeaders = this.getView().getModel("view").getProperty("/headers") || [];
          const aItems = aAllHeaders
            .filter((r) => {
              if (r.OpenFlag !== "X") return false;
              const d = r._DaysOut;
              return d !== null && d !== undefined && d >= range.min && d < range.max;
            })
            .map((r) => ({
              Belnr:    r.Belnr,
              _Budat:   r._Budat,
              Days:     r._DaysOut,
              DaysState: (r._DaysOut || 0) >= 90 ? "Error" : (r._DaysOut || 0) >= 30 ? "Warning" : "None",
              Blart:    (r.Blart || "").trim(),
              _BlartKor: r._BlartKor || "",
              BP:       r._BP || "-",
              Bltxt:    r.Bltxt || "",
            }))
            .sort((a, b) => b.Days - a.Days);

          const oVM = this.getView().getModel("view");
          oVM.setProperty("/agingDrill", {
            title:     "미결 전표 드릴다운 — " + sBucket + "  (" + aItems.length + "건)",
            subtitle:  "경과일 구간: " + sBucket + "  |  총 " + aItems.length + "건  |  경과일 내림차순 정렬",
            stripType: range.strip,
            items:     aItems,
          });
          this.byId("agingDrillDialog").open();
        },

        onAgingDrillClose() {
          this.byId("agingDrillDialog").close();
        },

        // 드릴다운 행 클릭 → 전표 조회 탭으로 이동
        onDrillRowPress(oEvent) {
          const sBelnr = oEvent.getSource().getBindingContext("view").getObject().Belnr;
          const oVM = this.getView().getModel("view");
          oVM.setProperty("/filters/Belnr", sBelnr);
          this.byId("agingDrillDialog").close();
          const oTabBar = this.byId("idMainTab");
          if (oTabBar) oTabBar.setSelectedKey("search");
          this.onSearch();
        },

        // ── 칩 클릭 → 전표유형 필터 ───────────────────────────────────
        onBlartChipPress(oEvent) {
          const oChipBox = oEvent.getSource().getParent();
          const sBlart = oChipBox.data("blart");
          const oVM = this.getView().getModel("view");
          oVM.setProperty("/filters/Blart", sBlart);
          this.onSearch();
        },

        // ── 페이지네이션 ───────────────────────────────────────────────
        _updatePagination() {
          const oVM = this.getView().getModel("view");
          const headers = oVM.getProperty("/headers");
          const page = oVM.getProperty("/page");
          const pgCount = Math.max(1, Math.ceil(headers.length / PAGE_SIZE));
          oVM.setProperty("/pageCount", pgCount);
          const start = (page - 1) * PAGE_SIZE;
          oVM.setProperty("/pageData", headers.slice(start, start + PAGE_SIZE));
        },

        onPrevPage() {
          const oVM = this.getView().getModel("view");
          const page = oVM.getProperty("/page");
          if (page > 1) {
            oVM.setProperty("/page", page - 1);
            this._updatePagination();
          }
        },
        onNextPage() {
          const oVM = this.getView().getModel("view");
          const page = oVM.getProperty("/page"),
            cnt = oVM.getProperty("/pageCount");
          if (page < cnt) {
            oVM.setProperty("/page", page + 1);
            this._updatePagination();
          }
        },

        // ── 헤더 행 선택 → 아이템 팝업 ────────────────────────────────
        onRowPress(oEvent) {
          const oVM = this.getView().getModel("view");
          const oHeader = oEvent
            .getSource()
            .getBindingContext("view")
            .getObject();

          const headers = oVM.getProperty("/headers");
          headers.forEach((h) => { h.__selected = false; });
          const idx = headers.findIndex(
            (h) => h.Bukrs === oHeader.Bukrs && h.Gjahr === oHeader.Gjahr && h.Belnr === oHeader.Belnr,
          );
          if (idx >= 0) headers[idx].__selected = true;
          oVM.setProperty("/headers", headers);
          this._updatePagination();

          oVM.setProperty("/selectedBelnr", oHeader.Belnr);
          oVM.setProperty("/selectedBltxt", oHeader.Bltxt || "");
          oVM.setProperty("/items", []);
          oVM.setProperty("/itemCount", "0");
          oVM.setProperty("/detailBusy", true);

          // 팝업 즉시 열기 → 내부 busy로 로딩 표시
          this.byId("idDetailDialog").open();

          const filters = [
            new Filter("Bukrs", FilterOperator.EQ, oHeader.Bukrs),
            new Filter("Gjahr", FilterOperator.EQ, oHeader.Gjahr),
            new Filter("Belnr", FilterOperator.EQ, oHeader.Belnr),
          ];

          this.getView()
            .getModel("itemService")
            .read("/ZCDS_E3_FI_0006", {
              filters: filters,
              success: (oData) => {
                const items = this._processItems(oData.results || []);
                oVM.setProperty("/items", items);
                oVM.setProperty("/itemCount", items.length.toLocaleString("ko-KR"));
                oVM.setProperty("/detailBusy", false);
              },
              error: () => {
                oVM.setProperty("/detailBusy", false);
                MessageBox.error("전표 아이템 조회 중 오류가 발생했습니다.");
              },
            });
        },

        onDetailDialogClose() {
          this.byId("idDetailDialog").close();
        },

        // ── 아이템 전처리 ──────────────────────────────────────────────
        _processItems(aResults) {
          return aResults.map((r) => ({
            ...r,
            _Wrbtr: this._fmtAmt(r.Wrbtr, r.Waers),
            _Dmbtr: this._fmtAmt(r.Dmbtr, "KRW"),
            _Augdt: this._fmtDate(r.Augdt, true),
            _ShkzgText: r.Shkzg === "S" ? "차변(S)" : "대변(H)",
            _ShkzgState: r.Shkzg === "S" ? "Information" : "Warning",
          }));
        },

        // ── 서치헬프 ──────────────────────────────────────────────────
        onBukrsVH() {
          const oVM = this.getView().getModel("view");
          const list = oVM.getProperty("/bukrsList");
          if (!list || list.length === 0) {
            this.getView()
              .getModel()
              .read("/ZCDS_E3_FI_0007", {
                urlParameters: { $select: "Bukrs", $top: "500" },
                success: (oData) => {
                  const unique = [
                    ...new Map(
                      (oData.results || []).map((r) => [
                        r.Bukrs,
                        { Bukrs: r.Bukrs, Butxt: "" },
                      ]),
                    ).values(),
                  ].sort((a, b) => a.Bukrs.localeCompare(b.Bukrs));
                  oVM.setProperty("/bukrsList", unique);
                  this.byId("bukrsVHDialog").open();
                },
                error: () => this.byId("bukrsVHDialog").open(),
              });
          } else {
            this.byId("bukrsVHDialog").open();
          }
        },
        onBukrsVHSearch(oEvent) {
          oEvent
            .getSource()
            .getBinding("items")
            .filter([
              new Filter(
                "Bukrs",
                FilterOperator.Contains,
                oEvent.getParameter("value"),
              ),
            ]);
        },
        onBukrsVHConfirm(oEvent) {
          const oItem = oEvent.getParameter("selectedItem");
          if (oItem)
            this.getView()
              .getModel("view")
              .setProperty("/filters/Bukrs", oItem.getTitle());
        },

        onBelnrVH() {
          const oVM = this.getView().getModel("view");
          const heads = oVM.getProperty("/headers") || [];
          oVM.setProperty(
            "/belnrList",
            heads.map((h) => ({
              Belnr: h.Belnr,
              Desc: [h.Blart, h._BlartKor, h._Bldat]
                .filter(Boolean)
                .join("  ·  "),
            })),
          );
          this.byId("belnrVHDialog").open();
        },
        onBelnrVHSearch(oEvent) {
          oEvent
            .getSource()
            .getBinding("items")
            .filter([
              new Filter(
                "Belnr",
                FilterOperator.Contains,
                oEvent.getParameter("value"),
              ),
            ]);
        },
        onBelnrVHConfirm(oEvent) {
          const oItem = oEvent.getParameter("selectedItem");
          if (oItem)
            this.getView()
              .getModel("view")
              .setProperty("/filters/Belnr", oItem.getTitle());
        },

        onBlartVH() {
          const oVM = this.getView().getModel("view");
          const list = Object.entries(BLART_KOR)
            .map(([k, v]) => ({ Blart: k, Kor: v }))
            .sort((a, b) => a.Blart.localeCompare(b.Blart));
          oVM.setProperty("/blartList", list);
          this.byId("blartVHDialog").open();
        },
        onBlartVHSearch(oEvent) {
          oEvent
            .getSource()
            .getBinding("items")
            .filter([
              new Filter(
                "Blart",
                FilterOperator.Contains,
                oEvent.getParameter("value"),
              ),
            ]);
        },
        onBlartVHConfirm(oEvent) {
          const oItem = oEvent.getParameter("selectedItem");
          if (oItem)
            this.getView()
              .getModel("view")
              .setProperty("/filters/Blart", oItem.getTitle());
        },

        // ── 초기화 ────────────────────────────────────────────────────
        onReset() {
          const oVM = this.getView().getModel("view");
          oVM.setProperty("/filters", {
            Gjahr: new Date().getFullYear().toString(),
            Blart: "",
            Belnr: "",
          });
          this.byId("idBudatFrom")?.setValue("");
          this.byId("idBudatTo")?.setValue("");
          oVM.setProperty("/headers", []);
          oVM.setProperty("/pageData", []);
          oVM.setProperty("/items", []);
          oVM.setProperty("/blartSummary", []);
          oVM.setProperty("/waersSummary", []);
          oVM.setProperty("/hasData", false);
          oVM.setProperty("/hasItems", false);
          oVM.setProperty("/totalCount", 0);
          oVM.setProperty("/page", 1);
          oVM.setProperty("/pageCount", 1);
          oVM.setProperty("/infoText", "");
          oVM.setProperty("/selectedBelnr", "");
          oVM.setProperty("/selectedBltxt", "");
          oVM.setProperty("/kpi", {
            total: "0", normal: "0", open: "0", cancelled: "0",
            arCount: "0", apCount: "0", arOpen: "0", apOpen: "0",
          });
        },

        // ── Excel 저장 ────────────────────────────────────────────────
        onExport() {
          const oVM = this.getView().getModel("view");
          const headers = oVM.getProperty("/headers");
          if (!headers || headers.length === 0) {
            return;
          }
          const columns = [
            { label: "전표번호", property: "Belnr" },
            { label: "회사코드", property: "Bukrs" },
            { label: "회계연도", property: "Gjahr" },
            { label: "전표유형", property: "Blart" },
            { label: "전표유형명", property: "_BlartKor" },
            { label: "전표일자", property: "_Bldat" },
            { label: "전기일", property: "_Budat" },
            { label: "전기월", property: "Monat" },
            { label: "전표텍스트", property: "Bltxt" },
            { label: "통화", property: "Waers" },
            { label: "환율", property: "_Kursf" },
            { label: "상태", property: "_BstatText" },
            { label: "미결여부", property: "_OpenText" },
            { label: "미결 경과일(일)", property: "_DaysOut" },
            { label: "BP번호", property: "_BP" },
            { label: "BP유형", property: "_BPType" },
            { label: "참조번호", property: "Xblnr" },
            { label: "전기자", property: "Ernam" },
            { label: "전기일자", property: "_Erdat" },
          ];
          new Spreadsheet({
            workbook: { columns },
            dataSource: headers,
            fileName: `전표조회_${this._todayStr()}.xlsx`,
          })
            .build()
            .then(() => {
              // export complete
            })
            .catch(() => {
              MessageBox.error("Excel 저장 중 오류가 발생했습니다.");
            });
        },

        // ── 날짜 포맷 ──────────────────────────────────────────────────
        _fmtDate(val, shortFmt) {
          if (!val) return "";
          let d = null;

          if (val instanceof Date) {
            d = val;
          } else if (typeof val === "string" && val.startsWith("/Date(")) {
            const ms = parseInt(val.replace(/\/Date\((-?\d+)\)\//, "$1"), 10);
            if (!isNaN(ms)) d = new Date(ms);
          } else if (typeof val === "string" && /^\d{8}$/.test(val)) {
            d = new Date(
              val.slice(0, 4),
              parseInt(val.slice(4, 6)) - 1,
              parseInt(val.slice(6, 8)),
            );
          } else if (
            typeof val === "string" &&
            /^\d{4}-\d{2}-\d{2}/.test(val)
          ) {
            d = new Date(
              val.slice(0, 4),
              parseInt(val.slice(5, 7)) - 1,
              parseInt(val.slice(8, 10)),
            );
          }

          if (d && !isNaN(d.getTime())) {
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            const dd = String(d.getDate()).padStart(2, "0");
            return shortFmt
              ? `${mm}월 ${dd}일`
              : `${d.getFullYear()}년 ${mm}월 ${dd}일`;
          }
          return String(val);
        },

        _fmtNum(val, dec) {
          const n = parseFloat(val);
          if (isNaN(n)) return val || "";
          return n.toLocaleString("ko-KR", {
            minimumFractionDigits: dec || 0,
            maximumFractionDigits: dec || 0,
          });
        },

        _fmtAmt(val, waers) {
          const n = parseFloat(val);
          if (isNaN(n)) return val || "";
          const dec = (waers || "").trim().toUpperCase() === "KRW" ? 0 : 2;
          return n.toLocaleString("ko-KR", {
            minimumFractionDigits: dec,
            maximumFractionDigits: dec,
          });
        },

        _todayStr() {
          const d = new Date();
          return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
        },
      },
    );
  },
);
