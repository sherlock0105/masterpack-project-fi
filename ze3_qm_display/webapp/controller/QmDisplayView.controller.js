sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
  ],
  function (Controller, JSONModel, Filter, FilterOperator, MessageToast) {
    "use strict";

    function _fmtDate(d) {
      if (!d) return "";
      var m = typeof d === "string" ? d.match(/\/Date\((\d+)\)\//) : null;
      if (m) d = new Date(parseInt(m[1], 10));
      if (!(d instanceof Date)) return String(d);
      return (
        d.getUTCFullYear() +
        "-" +
        ("0" + (d.getUTCMonth() + 1)).slice(-2) +
        "-" +
        ("0" + d.getUTCDate()).slice(-2)
      );
    }

    function _fmtQty(n) {
      var v = parseFloat(n) || 0;
      if (v === 0) return "0";
      return v % 1 === 0
        ? v.toLocaleString("ko-KR")
        : v.toLocaleString("ko-KR", {
            minimumFractionDigits: 1,
            maximumFractionDigits: 3,
          });
    }

    function _yyyymmdd(d) {
      return (
        d.getFullYear() +
        ("0" + (d.getMonth() + 1)).slice(-2) +
        ("0" + d.getDate()).slice(-2)
      );
    }

    function _iso(s) {
      return s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8);
    }

    return Controller.extend(
      "ze3.qm.display.ze3qmdisplay.controller.QmDisplayView",
      {
        onInit: function () {
          var oNow = new Date();
          var oFrom = new Date(oNow.getFullYear(), 0, 1);

          this.getView().setModel(
            new JSONModel({
              busy: false,
              detailBusy: false,
              kpi: {
                totalLots: "0",
                failLots: "0",
                failQtyFmt: "0",
                rateFmt: "0.0%",
                dateRange: "",
                failQtyRaw: 0,
                rateNum: 0,
                rateState: "None",
                momDelta: "-",
                momState: "None",
                currMon: "",
              },
              summary: { total: 0, failItems: 0 },
              inspList: [],
              matnrList: [],
              coq: { lossAmt: "데이터 없음" },
              threshold: { value: 5, exceeded: false },
              alerts: { showThreshold: false, thresholdMsg: "" },
              paretoFilter: { active: false, matnr: "" },
              quality: { contentFail: "-", packageFail: "-", otherFail: "-", contentPct: "-", packagePct: "-", otherPct: "-" },
              detail: {
                prueflos: "",
                matnr: "",
                maktx: "",
                charg: "",
                budatFmt: "",
                qiQtyFmt: "0",
                passQtyFmt: "0",
                failQtyFmt: "0",
                meins: "",
                items: [],
              },
            }),
            "view",
          );

          this.byId("idBudatFrom").setValue(_yyyymmdd(oFrom));
          this.byId("idBudatTo").setValue(_yyyymmdd(oNow));

          // ── [1단계] FLP 스타트업 파라미터를 인스턴스 변수에 저장만 함 ──
          // onInit 시점은 View가 완전히 그려지기 전일 수 있으므로
          // UI 조작(setValue)은 하지 않고 저장만 한다.
          var oData = this.getOwnerComponent().getComponentData();
          this._oStartupParams = (oData && oData.startupParameters) || {};

          // ── [2단계] 라우터 이벤트 연결 (in-app Cross-App Navigation용) ──
          this.getOwnerComponent()
            .getRouter()
            .getRoute("RouteQmDisplayView")
            .attachPatternMatched(this._onRouteMatched, this);
        },

        onAfterRendering: function () {
          // View가 여러 번 렌더링될 수 있으므로 최초 1회만 실행
          if (this._bInitDone) return;
          this._bInitDone = true;

          // ── [3단계] View 렌더링 완료 후 파라미터를 UI에 안전하게 적용 ──
          var sMat = ([].concat(
            this._oStartupParams.Material ||
            this._oStartupParams.Matnr   ||
            []
          ))[0] || "";

          if (sMat) {
            this.byId("idMatnr").setValue(sMat.trim());
          }

          // ── [4단계] OData 메타데이터 로딩 완료 후 자동 조회 실행 ──
          // metadataLoaded()는 Promise를 반환하므로
          // 메타데이터가 준비된 뒤에만 onSearch가 호출됨
          this.getOwnerComponent()
            .getModel()
            .metadataLoaded()
            .then(this.onSearch.bind(this));
        },

        // ── Cross-App Navigation (다른 앱 → 이 앱으로 재진입) 처리 ──────
        // 초기 로딩: onAfterRendering이 onSearch 담당
        // 재진입:    _onRouteMatched가 onSearch 담당
        _onRouteMatched: function (oEvent) {
          var oQuery = ((oEvent.getParameter("arguments") || {})["?query"]) || {};
          var sMat = oQuery.Material || oQuery.Matnr || oQuery.matnr || "";
          if (!sMat) return;

          this.byId("idMatnr").setValue(sMat.trim());

          if (this._bInitDone) {
            // _bInitDone = true이면 onAfterRendering이 이미 완료된 것
            // → 재진입 케이스이므로 직접 재조회
            this.onSearch();
          }
          // _bInitDone = false이면 onAfterRendering이 곧 onSearch를 호출하므로 생략
        },

        // ══ 조회 ════════════════════════════════════════════════════
        onSearch: function () {
          var sFrom = (this.byId("idBudatFrom").getValue() || "").replace(
            /-/g,
            "",
          );
          var sTo = (this.byId("idBudatTo").getValue() || "").replace(/-/g, "");
          var sMatnr = this.byId("idMatnr").getValue().trim();
          var sStats = this.byId("idStats").getSelectedKey();
          this._sFrom = sFrom;
          this._sTo = sTo;

          if (!sFrom || !sTo) {
            MessageToast.show("검수일 기간을 선택해주세요.");
            return;
          }
          if (sFrom > sTo) {
            MessageToast.show("시작일이 종료일보다 늦을 수 없습니다.");
            return;
          }

          var oVM = this.getView().getModel("view");
          oVM.setProperty("/busy", true);
          oVM.setProperty("/inspList", []);
          oVM.setProperty("/summary/total", 0);
          oVM.setProperty("/summary/failItems", 0);

          var aFilter = [
            "budat ge datetime'" + _iso(sFrom) + "T00:00:00'",
            "budat le datetime'" + _iso(sTo) + "T23:59:59'",
          ];
          if (sMatnr) aFilter.push("matnr eq '" + sMatnr + "'");
          if (sStats) aFilter.push("stats eq '" + sStats + "'");

          var a3Filter = [
            "budat ge datetime'" + _iso(sFrom) + "T00:00:00'",
            "budat le datetime'" + _iso(sTo) + "T23:59:59'",
          ];
          if (sMatnr) a3Filter.push("matnr eq '" + sMatnr + "'");

          var oMainModel = this.getOwnerComponent().getModel();
          var oQm3Model = this.getOwnerComponent().getModel("qm0003");
          var aQm0002 = null,
            aQm0003 = null,
            nDone = 0;
          var that = this;

          function _check() {
            nDone++;
            if (nDone < 2) return;
            oVM.setProperty("/busy", false);
            that._processData(aQm0002 || [], aQm0003 || []);
          }

          oMainModel.read("/ZCDS_E3_QM_0002", {
            urlParameters: { $filter: aFilter.join(" and ") },
            success: function (d) {
              aQm0002 = d.results || [];
              _check();
            },
            error: function () {
              aQm0002 = [];
              _check();
              MessageToast.show("검수 데이터 조회 오류");
            },
          });

          if (oQm3Model) {
            oQm3Model
              .metadataLoaded()
              .then(function () {
                oQm3Model.read("/ZCDS_E3_QM_0003", {
                  urlParameters: { $filter: a3Filter.join(" and ") },
                  success: function (d) {
                    aQm0003 = d.results || [];
                    _check();
                  },
                  error: function () {
                    aQm0003 = [];
                    _check();
                  },
                });
              })
              .catch(function () {
                aQm0003 = [];
                _check();
              });
          } else {
            aQm0003 = [];
            _check();
          }
        },

        // ══ 데이터 처리 ═════════════════════════════════════════════
        _processData: function (aQm0002, aQm0003) {
          var oVM = this.getView().getModel("view");

          // ── 자재유형 필터 ────────────────────────────────────────
          var idMatType = this.byId("idMatType");
          var sMatType = idMatType ? idMatType.getSelectedKey() : "ALL";
          if (sMatType && sMatType !== "ALL") {
            var _pfx = sMatType;
            aQm0002 = aQm0002.filter(function (r) {
              return (r.matnr || "").indexOf(_pfx) === 0;
            });
            aQm0003 = aQm0003.filter(function (r) {
              return (r.matnr || "").indexOf(_pfx) === 0;
            });
          }

          // ── 검수 목록 (중복 제거) ────────────────────────────────
          var mListKey = {};
          var aList = [];
          aQm0002.forEach(function (r) {
            var sKey = (r.prueflos || "") + "_" + (r.pruef_pos || "") + "_" + (r.matnr || "") + "_" + (r.charg || "");
            if (mListKey[sKey]) return;
            mListKey[sKey] = true;
            var fPass = parseFloat(r.pass_qty) || 0;
            var fFail = parseFloat(r.fail_qty) || 0;
            var fQi = parseFloat(r.qi_qty) || 0;
            var sStats = r.stats || "";
            aList.push({
              Prueflos: r.prueflos || "",
              PruefPos: r.pruef_pos || "",
              Matnr: r.matnr || "",
              Maktx: r.maktx || "",
              Charg: r.charg || "",
              BudatFmt: _fmtDate(r.budat),
              QiQtyFmt: _fmtQty(fQi),
              PassQtyFmt: _fmtQty(fPass),
              FailQtyFmt: _fmtQty(fFail),
              Meins: r.meins || "",
              StatsTxt: r.stats_txt || "",
              StatsState:
                sStats === "1"
                  ? "Warning"
                  : sStats === "3"
                    ? "Success"
                    : "None",
              _stats: sStats,
              _failQty: fFail,
              _qiQty: fQi,
            });
          });

          // ── KPI ─────────────────────────────────────────────────
          var nTotalQi = 0,
            nTotalFail = 0;
          aQm0002.forEach(function (r) {
            nTotalQi += parseFloat(r.qi_qty) || 0;
            nTotalFail += parseFloat(r.fail_qty) || 0;
          });
          var fRate = nTotalQi > 0 ? (nTotalFail / nTotalQi) * 100 : 0;

          var mAllLots = {},
            mFailLots = {};
          aQm0002.forEach(function (r) {
            if (r.prueflos) mAllLots[r.prueflos] = true;
          });
          (aQm0003 || []).forEach(function (r) {
            if (r.prueflos) mFailLots[r.prueflos] = true;
          });

          var sFrom = this.byId("idBudatFrom").getValue();
          var sTo = this.byId("idBudatTo").getValue();

          oVM.setProperty(
            "/kpi/totalLots",
            String(Object.keys(mAllLots).length),
          );
          oVM.setProperty(
            "/kpi/failLots",
            String(Object.keys(mFailLots).length),
          );
          oVM.setProperty("/kpi/failQtyFmt", _fmtQty(nTotalFail));
          oVM.setProperty("/kpi/rateFmt", fRate.toFixed(1) + "%");
          oVM.setProperty(
            "/kpi/dateRange",
            (sFrom || "") + " ~ " + (sTo || ""),
          );
          oVM.setProperty("/kpi/failQtyRaw", nTotalFail);
          oVM.setProperty("/kpi/rateNum", fRate);

          // ── Feature 4: 불합격률 상태 (고정 기준: 3%/5%) ─────────
          var sRateState =
            fRate <= 3 ? "Success" : fRate <= 5 ? "Warning" : "Error";
          oVM.setProperty("/kpi/rateState", sRateState);
          var bExceeded = fRate > 5;
          oVM.setProperty("/threshold/exceeded", bExceeded);
          oVM.setProperty("/alerts/showThreshold", bExceeded);
          oVM.setProperty(
            "/alerts/thresholdMsg",
            "불합격률 " +
              fRate.toFixed(1) +
              "% — 기준 5% 초과. 즉시 품질 점검이 필요합니다.",
          );

          // ── Feature 1: total_cost 합산 (표준원가 × 불합격수량) ──
          var nTotalCost = 0;
          aQm0002.forEach(function (r) {
            nTotalCost += parseFloat(r.total_cost) || 0;
          });
          var _fmtCost = function (n) {
            if (n >= 100000000) return (n / 100000000).toFixed(1) + " 억원";
            if (n >= 1000000)   return (n / 1000000).toFixed(1) + " 백만원";
            return Math.round(n).toLocaleString("ko-KR") + " 원";
          };
          oVM.setProperty("/coq/lossAmt", nTotalCost > 0 ? _fmtCost(nTotalCost) : "데이터 없음");

          // ── MoM 비교 (직전 월 대비 불합격 수량 증감) ─────────────
          var mMonthFail = {};
          (aQm0003 || []).forEach(function (r) {
            var sDate = _fmtDate(r.budat);
            if (!sDate) return;
            var sMon = sDate.slice(0, 7);
            mMonthFail[sMon] = (mMonthFail[sMon] || 0) + (parseFloat(r.fail_qty) || 0);
          });
          var aSortedMons = Object.keys(mMonthFail).sort();
          var nCurrMonFail = 0, nPrevMonFail = 0, sCurrMon = "";
          if (aSortedMons.length >= 1) {
            sCurrMon = aSortedMons[aSortedMons.length - 1];
            nCurrMonFail = mMonthFail[sCurrMon];
          }
          if (aSortedMons.length >= 2) {
            nPrevMonFail = mMonthFail[aSortedMons[aSortedMons.length - 2]];
          }
          var sMomDelta = "-", sMomState = "None";
          if (nPrevMonFail > 0) {
            var fMomPct = ((nCurrMonFail - nPrevMonFail) / nPrevMonFail) * 100;
            sMomDelta = (fMomPct >= 0 ? "▲" : "▼") + Math.abs(fMomPct).toFixed(1) + "%";
            sMomState = fMomPct <= 0 ? "Success" : "Error";
          } else if (nCurrMonFail > 0) {
            sMomDelta = "신규 발생";
            sMomState = "Warning";
          }
          oVM.setProperty("/kpi/momDelta", sMomDelta);
          oVM.setProperty("/kpi/momState", sMomState);
          oVM.setProperty("/kpi/currMon", sCurrMon ? sCurrMon + " 기준" : "");

          // ── 불량사유 그룹화 (내용물 vs 부자재) ──────────────────
          var CONTENT_KW = ["ph", "미생물", "냄새", "변색", "점도", "색상", "이물"];
          var PACKAGE_KW = ["파손", "라벨", "용기", "포장", "외관", "스크래치"];
          var nContentFail = 0, nPackFail = 0, nOtherFail = 0;
          (aQm0003 || []).forEach(function (r) {
            var sNm = (r.insp_nm || "").toLowerCase();
            var fFail = parseFloat(r.fail_qty) || 0;
            if (CONTENT_KW.some(function (kw) { return sNm.indexOf(kw) >= 0; })) {
              nContentFail += fFail;
            } else if (PACKAGE_KW.some(function (kw) { return sNm.indexOf(kw) >= 0; })) {
              nPackFail += fFail;
            } else {
              nOtherFail += fFail;
            }
          });
          var nGrpTot = nContentFail + nPackFail + nOtherFail;
          oVM.setProperty("/quality", {
            contentFail: _fmtQty(nContentFail),
            packageFail: _fmtQty(nPackFail),
            otherFail:   _fmtQty(nOtherFail),
            contentPct:  nGrpTot > 0 ? ((nContentFail / nGrpTot) * 100).toFixed(0) + "%" : "-",
            packagePct:  nGrpTot > 0 ? ((nPackFail   / nGrpTot) * 100).toFixed(0) + "%" : "-",
            otherPct:    nGrpTot > 0 ? ((nOtherFail  / nGrpTot) * 100).toFixed(0) + "%" : "-",
          });

          // ── Feature 5: 파레토 드릴다운용 원본 목록 저장 ─────────
          this._aRawInspList = aList;
          oVM.setProperty("/paretoFilter/active", false);
          oVM.setProperty("/paretoFilter/matnr", "");

          // ── 자재코드 서치헬프 목록 ───────────────────────────────
          var mMap = {};
          aList.forEach(function (r) {
            if (r.Matnr) mMap[r.Matnr] = r.Maktx || "";
          });
          var aMList = Object.keys(mMap)
            .sort()
            .map(function (k) {
              return { matnr: k, maktx: mMap[k] };
            });

          oVM.setProperty("/inspList", aList);
          oVM.setProperty("/matnrList", aMList);
          oVM.setProperty("/summary/total", aList.length);
          oVM.setProperty("/summary/failItems", aQm0003.length);

          if (!aList.length && !aQm0003.length) {
            MessageToast.show("조회된 데이터가 없습니다.");
          }

          this._buildParetoChart(aQm0003);
          this._buildReasonChart(aQm0003);
          this._buildStackedChart(aQm0003);
        },

        // ── 자재별 파레토 ────────────────────────────────────────
        _buildParetoChart: function (aQm0003) {
          var oViz = this.byId("idParetoChart");
          if (!oViz) return;

          var mMatnr = {};
          (aQm0003 || []).forEach(function (r) {
            var k = r.matnr || "";
            if (!k) return;
            if (!mMatnr[k]) mMatnr[k] = { Matnr: k, FailQty: 0 };
            mMatnr[k].FailQty += parseFloat(r.fail_qty) || 0;
          });

          var aChart = Object.keys(mMatnr)
            .map(function (k) {
              return mMatnr[k];
            })
            .sort(function (a, b) {
              var d = b.FailQty - a.FailQty;
              return d !== 0 ? d : a.Matnr.localeCompare(b.Matnr);
            })
            .slice(0, 10);

          var nTotal = aChart.reduce(function (s, d) {
            return s + d.FailQty;
          }, 0);
          var nCum = 0;
          aChart.forEach(function (d) {
            nCum += d.FailQty;
            d.CumPct = nTotal > 0 ? Math.round((nCum / nTotal) * 1000) / 10 : 0;
          });

          sap.ui.require(
            [
              "sap/viz/ui5/data/FlattenedDataset",
              "sap/viz/ui5/controls/common/feeds/FeedItem",
            ],
            function (FlattenedDataset, FeedItem) {
              oViz.setModel(new JSONModel({ data: aChart }));
              oViz.setDataset(
                new FlattenedDataset({
                  dimensions: [{ name: "자재코드", value: "{Matnr}" }],
                  measures: [
                    { name: "불합격수량", value: "{FailQty}" },
                    { name: "누적비율", value: "{CumPct}" },
                  ],
                  data: { path: "/data" },
                }),
              );
              oViz.removeAllFeeds();
              oViz.addFeed(
                new FeedItem({
                  uid: "valueAxis",
                  type: "Measure",
                  values: ["불합격수량"],
                }),
              );
              oViz.addFeed(
                new FeedItem({
                  uid: "valueAxis2",
                  type: "Measure",
                  values: ["누적비율"],
                }),
              );
              oViz.addFeed(
                new FeedItem({
                  uid: "categoryAxis",
                  type: "Dimension",
                  values: ["자재코드"],
                }),
              );
              oViz.setVizProperties({
                title: { visible: false },
                plotArea: {
                  colorPalette: ["#1565c0", "#e65100"],
                  dataLabel: { visible: true },
                  line: { marker: { visible: true, size: 6 } },
                },
                valueAxis: { title: { visible: false } },
                valueAxis2: { title: { visible: false }, min: 0, max: 100 },
                categoryAxis: {
                  title: { visible: false },
                  label: { rotation: -30, truncateLabel: false },
                },
                legend: { visible: true, position: "top" },
                interaction: { selectability: { mode: "EXCLUSIVE" } },
              });
            },
          );
        },

        // ── 폐기 사유별 구성비 (도넛) ───────────────────────────
        _buildReasonChart: function (aQm0003) {
          var oViz = this.byId("idReasonChart");
          if (!oViz) return;

          var mReason = {};
          (aQm0003 || []).forEach(function (r) {
            var k = r.insp_nm || "";
            if (!k) return;
            if (!mReason[k]) mReason[k] = { Reason: k, FailQty: 0 };
            mReason[k].FailQty += parseFloat(r.fail_qty) || 0;
          });

          var aChart = Object.keys(mReason)
            .map(function (k) {
              return mReason[k];
            })
            .sort(function (a, b) {
              return b.FailQty - a.FailQty;
            });

          sap.ui.require(
            [
              "sap/viz/ui5/data/FlattenedDataset",
              "sap/viz/ui5/controls/common/feeds/FeedItem",
            ],
            function (FlattenedDataset, FeedItem) {
              oViz.setModel(new JSONModel({ data: aChart }));
              oViz.setDataset(
                new FlattenedDataset({
                  dimensions: [{ name: "검사항목", value: "{Reason}" }],
                  measures: [{ name: "불합격수량", value: "{FailQty}" }],
                  data: { path: "/data" },
                }),
              );
              oViz.removeAllFeeds();
              oViz.addFeed(
                new FeedItem({
                  uid: "size",
                  type: "Measure",
                  values: ["불합격수량"],
                }),
              );
              oViz.addFeed(
                new FeedItem({
                  uid: "color",
                  type: "Dimension",
                  values: ["검사항목"],
                }),
              );
              oViz.setVizProperties({
                title: { visible: false },
                legend: { visible: true, position: "right" },
                plotArea: {
                  dataLabel: {
                    visible: true,
                    type: "percentage",
                    style: { fontSize: "11px", fontWeight: "bold" },
                  },
                },
                tooltip: { formatString: { 불합격수량: "#,##0" } },
              });
            },
          );
        },

        // ── 월별 불합격 추이 (영역 차트) ────────────────────────
        _buildMonthlyChart: function (aQm0003) {
          var oViz = this.byId("idMonthlyChart");
          if (!oViz) return;

          var mMonth = {};
          (aQm0003 || []).forEach(function (r) {
            var sDate = _fmtDate(r.budat);
            if (!sDate) return;
            var sMon = sDate.slice(0, 7);
            if (!mMonth[sMon]) mMonth[sMon] = { Month: sMon, FailQty: 0 };
            mMonth[sMon].FailQty += parseFloat(r.fail_qty) || 0;
          });

          var sFromM = this._sFrom || "";
          var sToM = this._sTo || "";
          if (sFromM.length >= 6 && sToM.length >= 6) {
            var nY = parseInt(sFromM.slice(0, 4), 10);
            var nMo = parseInt(sFromM.slice(4, 6), 10);
            var nYTo = parseInt(sToM.slice(0, 4), 10);
            var nMoTo = parseInt(sToM.slice(4, 6), 10);
            while (nY < nYTo || (nY === nYTo && nMo <= nMoTo)) {
              var sFillMon = nY + "-" + ("0" + nMo).slice(-2);
              if (!mMonth[sFillMon])
                mMonth[sFillMon] = { Month: sFillMon, FailQty: 0 };
              nMo++;
              if (nMo > 12) {
                nMo = 1;
                nY++;
              }
            }
          }

          var aChart = Object.keys(mMonth)
            .sort()
            .map(function (k) {
              return mMonth[k];
            });

          sap.ui.require(
            [
              "sap/viz/ui5/data/FlattenedDataset",
              "sap/viz/ui5/controls/common/feeds/FeedItem",
            ],
            function (FlattenedDataset, FeedItem) {
              oViz.setModel(new JSONModel({ data: aChart }));
              oViz.setDataset(
                new FlattenedDataset({
                  dimensions: [{ name: "월", value: "{Month}" }],
                  measures: [{ name: "불합격수량", value: "{FailQty}" }],
                  data: { path: "/data" },
                }),
              );
              oViz.removeAllFeeds();
              oViz.addFeed(
                new FeedItem({
                  uid: "valueAxis",
                  type: "Measure",
                  values: ["불합격수량"],
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
                  colorPalette: ["#1565c0"],
                  dataLabel: { visible: true },
                  line: { marker: { visible: true, size: 5 } },
                },
                valueAxis: { title: { visible: false } },
                categoryAxis: { title: { visible: false } },
              });
            },
          );
        },

        // ── Feature 2: 불합격 사유별 월간 누적 (stacked_column) ──
        _buildStackedChart: function (aQm0003) {
          var oViz = this.byId("idStackedChart");
          if (!oViz) return;

          var mReasonTotal = {};
          (aQm0003 || []).forEach(function (r) {
            var k = r.insp_nm || "미분류";
            mReasonTotal[k] =
              (mReasonTotal[k] || 0) + (parseFloat(r.fail_qty) || 0);
          });

          var aTopReasons = Object.keys(mReasonTotal)
            .sort(function (a, b) {
              return mReasonTotal[b] - mReasonTotal[a];
            })
            .slice(0, 5);
          var mTopSet = {};
          aTopReasons.forEach(function (r) {
            mTopSet[r] = true;
          });
          var bHasOther = Object.keys(mReasonTotal).length > 5;

          var mData = {};
          (aQm0003 || []).forEach(function (r) {
            var sDate = _fmtDate(r.budat);
            if (!sDate) return;
            var sMon = sDate.slice(0, 7);
            var sReason = mTopSet[r.insp_nm] ? r.insp_nm || "미분류" : "기타";
            if (!mData[sMon]) mData[sMon] = {};
            mData[sMon][sReason] =
              (mData[sMon][sReason] || 0) + (parseFloat(r.fail_qty) || 0);
          });

          var aAllReasons = aTopReasons.slice();
          if (bHasOther) aAllReasons.push("기타");
          var aAllMonths = Object.keys(mData).sort();

          var aChartData = [];
          aAllMonths.forEach(function (sMon) {
            aAllReasons.forEach(function (sReason) {
              aChartData.push({
                Month: sMon,
                Reason: sReason,
                FailQty: (mData[sMon] || {})[sReason] || 0,
              });
            });
          });

          sap.ui.require(
            [
              "sap/viz/ui5/data/FlattenedDataset",
              "sap/viz/ui5/controls/common/feeds/FeedItem",
            ],
            function (FlattenedDataset, FeedItem) {
              oViz.setModel(new JSONModel({ data: aChartData }));
              oViz.setDataset(
                new FlattenedDataset({
                  dimensions: [
                    { name: "월", value: "{Month}" },
                    { name: "사유", value: "{Reason}" },
                  ],
                  measures: [{ name: "불합격수량", value: "{FailQty}" }],
                  data: { path: "/data" },
                }),
              );
              oViz.removeAllFeeds();
              oViz.addFeed(
                new FeedItem({
                  uid: "valueAxis",
                  type: "Measure",
                  values: ["불합격수량"],
                }),
              );
              oViz.addFeed(
                new FeedItem({
                  uid: "categoryAxis",
                  type: "Dimension",
                  values: ["월"],
                }),
              );
              oViz.addFeed(
                new FeedItem({
                  uid: "color",
                  type: "Dimension",
                  values: ["사유"],
                }),
              );
              oViz.setVizProperties({
                title: { visible: false },
                plotArea: { dataLabel: { visible: false } },
                valueAxis: { title: { visible: false } },
                categoryAxis: { title: { visible: false } },
                legend: { visible: true, position: "bottom" },
              });
            },
          );
        },

        // ── Feature 3: 생산오더별 불합격 현황 (column) ──────────
        _buildAufnrChart: function (aQm0002) {
          var oViz = this.byId("idAufnrChart");
          if (!oViz) return;

          var mAufnr = {};
          (aQm0002 || []).forEach(function (r) {
            var fFail = parseFloat(r.fail_qty) || 0;
            if (fFail <= 0) return;
            var k =
              r.aufnr && r.aufnr.trim()
                ? r.aufnr.trim()
                : r.ebeln && r.ebeln.trim()
                  ? "PO-" + r.ebeln.trim()
                  : null;
            if (!k) return;
            if (!mAufnr[k]) mAufnr[k] = { Order: k, FailQty: 0 };
            mAufnr[k].FailQty += fFail;
          });

          var aChart = Object.keys(mAufnr)
            .map(function (k) {
              return mAufnr[k];
            })
            .sort(function (a, b) {
              return b.FailQty - a.FailQty;
            })
            .slice(0, 10);

          sap.ui.require(
            [
              "sap/viz/ui5/data/FlattenedDataset",
              "sap/viz/ui5/controls/common/feeds/FeedItem",
            ],
            function (FlattenedDataset, FeedItem) {
              oViz.setModel(new JSONModel({ data: aChart }));
              oViz.setDataset(
                new FlattenedDataset({
                  dimensions: [{ name: "오더번호", value: "{Order}" }],
                  measures: [{ name: "불합격수량", value: "{FailQty}" }],
                  data: { path: "/data" },
                }),
              );
              oViz.removeAllFeeds();
              oViz.addFeed(
                new FeedItem({
                  uid: "valueAxis",
                  type: "Measure",
                  values: ["불합격수량"],
                }),
              );
              oViz.addFeed(
                new FeedItem({
                  uid: "categoryAxis",
                  type: "Dimension",
                  values: ["오더번호"],
                }),
              );
              oViz.setVizProperties({
                title: { visible: false },
                plotArea: {
                  colorPalette: ["#e65100"],
                  dataLabel: { visible: true },
                },
                valueAxis: { title: { visible: false } },
                categoryAxis: {
                  title: { visible: false },
                  label: { rotation: -30, truncateLabel: false },
                },
                legend: { visible: false },
              });
            },
          );
        },

        // ── Feature 5: 파레토 드릴다운 → 테이블 필터 ─────────────
        onParetoSelect: function (oEvent) {
          var aData = oEvent.getParameter("data") || [];
          var oVM = this.getView().getModel("view");
          if (!aData.length) {
            this.onParetoClearFilter();
            return;
          }
          var sMatnr = ((aData[0] || {}).data || {})["자재코드"] || "";
          if (!sMatnr) {
            this.onParetoClearFilter();
            return;
          }
          var aFiltered = (this._aRawInspList || []).filter(function (r) {
            return r.Matnr === sMatnr;
          });
          oVM.setProperty("/inspList", aFiltered);
          oVM.setProperty("/summary/total", aFiltered.length);
          oVM.setProperty("/paretoFilter/active", true);
          oVM.setProperty("/paretoFilter/matnr", sMatnr);
        },

        onParetoClearFilter: function () {
          var oVM = this.getView().getModel("view");
          var aRaw = this._aRawInspList || [];
          oVM.setProperty("/inspList", aRaw);
          oVM.setProperty("/summary/total", aRaw.length);
          oVM.setProperty("/paretoFilter/active", false);
          oVM.setProperty("/paretoFilter/matnr", "");
          var oViz = this.byId("idParetoChart");
          if (oViz && oViz.vizSelection) {
            try {
              oViz.vizSelection([], { clearSelection: true });
            } catch (e) {
              /* ignore */
            }
          }
        },

        // ══ 자재코드 서치헬프 ════════════════════════════════════
        onMatnrValueHelp: function () {
          var aList =
            this.getView().getModel("view").getProperty("/matnrList") || [];
          if (!aList.length) {
            MessageToast.show("먼저 조회를 실행해주세요.");
            return;
          }
          this.byId("idMatnrDialog").open();
        },

        onMatnrDialogConfirm: function (oEvent) {
          var oItem = oEvent.getParameter("selectedItem");
          if (oItem) this.byId("idMatnr").setValue(oItem.getTitle());
          oEvent.getSource().getBinding("items").filter([]);
        },

        onMatnrDialogCancel: function (oEvent) {
          oEvent.getSource().getBinding("items").filter([]);
        },

        onMatnrDialogSearch: function (oEvent) {
          var sVal = oEvent.getParameter("value");
          var aFilters = sVal
            ? [new Filter("matnr", FilterOperator.Contains, sVal)]
            : [];
          oEvent.getSource().getBinding("items").filter(aFilters);
        },

        // ══ 결과조회 상세 팝업 ═══════════════════════════════════
        onDetailPress: function (oEvent) {
          var oRow = oEvent.getSource().getBindingContext("view").getObject();
          this._doOpenDetail(oRow);
        },

        _doOpenDetail: function (oRow) {
          var oVM = this.getView().getModel("view");

          oVM.setProperty("/detail/prueflos", oRow.Prueflos);
          oVM.setProperty("/detail/matnr", oRow.Matnr);
          oVM.setProperty("/detail/maktx", oRow.Maktx || "");
          oVM.setProperty("/detail/charg", oRow.Charg);
          oVM.setProperty("/detail/budatFmt", oRow.BudatFmt);
          oVM.setProperty("/detail/qiQtyFmt", oRow.QiQtyFmt);
          oVM.setProperty("/detail/passQtyFmt", oRow.PassQtyFmt);
          oVM.setProperty("/detail/failQtyFmt", oRow.FailQtyFmt);
          oVM.setProperty("/detail/meins", oRow.Meins);
          oVM.setProperty("/detail/items", []);
          oVM.setProperty("/detailBusy", true);

          this.byId("idDetailDialog").open();

          var oQm3Model = this.getOwnerComponent().getModel("qm0003");
          if (!oQm3Model) {
            oVM.setProperty("/detailBusy", false);
            MessageToast.show("qm0003 서비스를 찾을 수 없습니다.");
            return;
          }

          oQm3Model.read("/ZCDS_E3_QM_0003", {
            urlParameters: {
              $filter:
                "prueflos eq '" +
                oRow.Prueflos +
                "' and matnr eq '" +
                oRow.Matnr +
                "'",
            },
            success: function (d) {
              var aItems = (d.results || []).map(function (r) {
                return {
                  InspCd: r.insp_cd || "",
                  InspNm: r.insp_nm || "",
                  FailQtyFmt: _fmtQty(r.fail_qty),
                  Meins: r.meins || "",
                };
              });
              oVM.setProperty("/detail/items", aItems);
              oVM.setProperty("/detailBusy", false);
            },
            error: function () {
              oVM.setProperty("/detailBusy", false);
              MessageToast.show("불합격 상세 데이터 조회 오류");
            },
          });
        },

        onDetailClose: function () {
          this.byId("idDetailDialog").close();
        },

        // ══════════════════════════════════════════════════════════════
        // 검사 결과 입력 (테이블 버튼 or QR 스캔 연동)
        // ══════════════════════════════════════════════════════════════

        // ── 테이블 "결과입력" 버튼 클릭 ──────────────────────────────
        onResultEntryPress: function (oEvent) {
          var oRow = oEvent.getSource().getBindingContext("view").getObject();
          this._openResultEntry(oRow);
        },

        // ── 결과 입력 팝업 열기 (QR 스캔 / 버튼 공통 진입점) ─────────
        _openResultEntry: function (oRow) {
          var oVM   = this.getView().getModel("view");
          var aList = oVM.getProperty("/inspList") || [];

          // 목록에서 상세 데이터 보완 (QR 스캔으로 로트번호만 넘어온 경우)
          if (!oRow.Matnr) {
            var oFound = aList.find(function (r) {
              return r.Prueflos === oRow.Prueflos;
            });
            if (oFound) {
              oRow = oFound;
            } else {
              // 목록에 없으면 먼저 조회 안내
              MessageToast.show(
                "[" + oRow.Prueflos + "] 검수 목록에 없습니다. 먼저 조회를 실행하세요."
              );
              return;
            }
          }

          // 검사대기 수량
          var fQiQty = parseFloat(oRow._qiQty) || 0;

          // 결과 입력 모델 초기화
          oVM.setProperty("/resultEntry", {
            prueflos:   oRow.Prueflos  || "",
            matnr:      oRow.Matnr     || "",
            maktx:      oRow.Maktx     || "",
            meins:      oRow.Meins     || "EA",
            qiQty:      fQiQty,
            passQty:    fQiQty,         // 기본값: 전량 합격
            failQty:    0,
            failReason: "",
            busy:       false
          });

          // 팝업 최초 1회 생성
          if (!this._oResultDialog) {
            this._oResultDialog = this._buildResultDialog();
            // view 모델 연결
            this._oResultDialog.setModel(this.getView().getModel("view"), "view");
          }
          this._oResultDialog.open();
        },

        // ── 결과 입력 다이얼로그 생성 ─────────────────────────────────
        _buildResultDialog: function () {
          var that = this;

          // 기본 정보 헤더
          var oInfoBox = new sap.m.VBox({
            class: "qmResultInfoBox",
            items: [
              new sap.m.HBox({
                justifyContent: "SpaceBetween",
                items: [
                  new sap.m.VBox({
                    items: [
                      new sap.m.Label({ text: "검사 로트", design: "Bold" }),
                      new sap.m.Text({ text: "{view>/resultEntry/prueflos}" })
                    ]
                  }),
                  new sap.m.VBox({
                    alignItems: "End",
                    items: [
                      new sap.m.Label({ text: "자재코드" }),
                      new sap.m.Text({ text: "{view>/resultEntry/matnr}" })
                    ]
                  })
                ]
              }),
              new sap.m.Text({
                text: "{view>/resultEntry/maktx}",
                class: "sapUiTinyMarginTop"
              })
            ]
          });

          // 검사대기 수량 표시 (중앙)
          var oQiRow = new sap.m.HBox({
            justifyContent: "Center",
            class: "qmResultQiBox",
            items: [
              new sap.m.VBox({
                alignItems: "Center",
                items: [
                  new sap.m.Label({ text: "검사대기 수량 (전체)" }),
                  new sap.m.ObjectNumber({
                    number: "{view>/resultEntry/qiQty}",
                    unit: "{view>/resultEntry/meins}",
                    emphasized: true,
                    class: "sapUiTinyMarginTop"
                  })
                ]
              })
            ]
          });

          // 결과 입력 폼 (합격수량 / 불합격수량 / 사유)
          var _row = function (sLabel, oControl) {
            return new sap.m.HBox({
              class: "qmResultFormRow",
              items: [
                new sap.m.Label({ text: sLabel, class: "qmResultFormLabel" }),
                oControl
              ]
            });
          };

          var oPassInput = new sap.m.Input({
            value: "{view>/resultEntry/passQty}",
            type: "Number",
            description: "{view>/resultEntry/meins}",
            width: "160px",
            liveChange: function (oEv) {
              var fPass = parseFloat(oEv.getParameter("value")) || 0;
              var fQi   = parseFloat(
                that.getView().getModel("view").getProperty("/resultEntry/qiQty")
              ) || 0;
              that.getView().getModel("view")
                .setProperty("/resultEntry/failQty", Math.max(0, fQi - fPass));
            }
          });

          var oFailInput = new sap.m.Input({
            value: "{view>/resultEntry/failQty}",
            type: "Number",
            description: "{view>/resultEntry/meins}",
            width: "160px",
            editable: false  // 자동 계산 (검사대기 - 합격수량)
          });

          var oReasonInput = new sap.m.TextArea({
            value: "{view>/resultEntry/failReason}",
            placeholder: "불합격 사유 입력 (선택)",
            rows: 2,
            width: "100%"
          });

          var oFormBox = new sap.m.VBox({
            class: "qmResultFormBox",
            items: [
              _row("합격수량 *",  oPassInput),
              _row("불합격수량",  oFailInput),
              _row("불합격 사유", oReasonInput)
            ]
          });

          return new sap.m.Dialog({
            title: "검사 결과 입력",
            contentWidth: "420px",
            busy: "{view>/resultEntry/busy}",
            busyIndicatorDelay: 0,
            content: [oInfoBox, oQiRow, oFormBox],
            beginButton: new sap.m.Button({
              text: "저장",
              type: "Emphasized",
              icon: "sap-icon://save",
              press: function () { that.onSaveResult(); }
            }),
            endButton: new sap.m.Button({
              text: "취소",
              press: function () { that._oResultDialog.close(); }
            })
          });
        },

        // ── OData POST 저장 ───────────────────────────────────────────
        onSaveResult: function () {
          var that  = this;
          var oVM   = this.getView().getModel("view");
          var oData = oVM.getProperty("/resultEntry");
          var fPass = parseFloat(oData.passQty) || 0;
          var fFail = parseFloat(oData.failQty) || 0;
          var fQi   = parseFloat(oData.qiQty)   || 0;

          // ── 유효성 검사 ──────────────────────────────────────────
          if (fPass < 0 || fPass > fQi) {
            MessageToast.show("합격수량(" + fPass + ")이 검사대기 수량(" + fQi + ")을 초과합니다.");
            return;
          }
          if (fFail > 0 && !oData.failReason) {
            MessageToast.show("불합격 수량이 있을 경우 사유를 입력해주세요.");
            return;
          }

          oVM.setProperty("/resultEntry/busy", true);

          // ── OData 저장 호출 ──────────────────────────────────────
          // ※ 백엔드 담당자 확인 필요:
          //   - SEGW에서 ZQM_RESULT_SET 엔티티 CREATE 메서드 구현
          //   - 필드명(Prueflos, PassQty, FailQty, FailReason, Meins) 일치 여부 확인
          var oModel = this.getOwnerComponent().getModel();
          oModel.create("/ZQM_RESULT_SET", {
            Prueflos:   oData.prueflos,
            Matnr:      oData.matnr,
            PassQty:    fPass.toString(),
            FailQty:    fFail.toString(),
            FailReason: oData.failReason || "",
            Meins:      oData.meins
          }, {
            success: function () {
              oVM.setProperty("/resultEntry/busy", false);
              that._oResultDialog.close();
              MessageToast.show(
                oData.prueflos + " 결과 저장 완료 (합격: " +
                _fmtQty(fPass) + " / 불합격: " + _fmtQty(fFail) + " " +
                oData.meins + ")"
              );
              that.onSearch(); // 목록 새로고침
            }.bind(this),
            error: function (oErr) {
              oVM.setProperty("/resultEntry/busy", false);
              var sMsg = "저장 실패";
              try {
                sMsg = JSON.parse(oErr.responseText).error.message.value;
              } catch (e) { /* ignore */ }
              sap.m.MessageBox.error(sMsg, { title: "OData 오류" });
            }
          });
        },

      },
    );
  },
);
