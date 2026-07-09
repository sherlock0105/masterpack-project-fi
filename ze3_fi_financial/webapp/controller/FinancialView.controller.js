sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
  ],
  function (
    Controller,
    JSONModel,
    MessageBox,
    Filter,
    FilterOperator,
    MessageToast,
  ) {
    "use strict";

    var CLASS_MAP = {
      11: { sec: "asset", roman: "Ⅰ", lv2: "유동자산", sort: 1 },
      13: { sec: "asset", roman: "Ⅱ", lv2: "비유동자산", sort: 2 },
      21: { sec: "liab", roman: "Ⅰ", lv2: "유동부채", sort: 1 },
      23: { sec: "liab", roman: "Ⅱ", lv2: "비유동부채", sort: 2 },
      31: { sec: "equity", roman: "Ⅰ", lv2: "납입자본", sort: 1 },
      32: { sec: "equity", roman: "Ⅱ", lv2: "이익잉여금", sort: 2 },
      33: { sec: "equity", roman: "Ⅲ", lv2: "기타포괄손익누계액", sort: 3 },
    };

    function _fmt(n) {
      if (n === 0) return "-";
      if (n < 0) return "-" + Math.abs(Math.round(n)).toLocaleString("ko-KR");
      return Math.round(n).toLocaleString("ko-KR");
    }

    function _fmtKpi(n) {
      if (n === 0) return "0";
      var abs = Math.abs(Math.round(n));
      var sign = n < 0 ? "-" : "";
      if (abs >= 1000000000000)
        return sign + (abs / 1000000000000).toFixed(1) + " 조";
      if (abs >= 100000000)
        return (
          sign + Math.floor(abs / 100000000).toLocaleString("ko-KR") + " 억"
        );
      if (abs >= 10000)
        return sign + Math.floor(abs / 10000).toLocaleString("ko-KR") + " 만";
      return sign + abs.toLocaleString("ko-KR");
    }

    function _toOk(n) {
      return parseFloat((n / 100000000).toFixed(2));
    }

    function _fmtDelta(curr, prev) {
      if (!prev) return { text: "전기 데이터 없음", pos: null };
      var pct = ((curr - prev) / Math.abs(prev)) * 100;
      var sign = pct >= 0 ? "▲ +" : "▼ ";
      return { text: sign + pct.toFixed(1) + "% (전기 대비)", pos: pct >= 0 };
    }

    function _fmtRatio(val) {
      if (val === null || val === undefined || !isFinite(val)) return "N/A";
      return val.toFixed(1) + "%";
    }

    function _ratioState(type, val) {
      if (val === null || val === undefined || !isFinite(val)) {
        return { state: "None", label: "N/A" };
      }
      if (type === "current") {
        if (val >= 200) return { state: "Success", label: "양호" };
        if (val >= 100) return { state: "Warning", label: "주의" };
        return { state: "Error", label: "위험" };
      }
      if (type === "debt") {
        if (val <= 100) return { state: "Success", label: "양호" };
        if (val <= 200) return { state: "Warning", label: "주의" };
        return { state: "Error", label: "위험" };
      }
      if (type === "quick") {
        if (val >= 100) return { state: "Success", label: "양호" };
        if (val >= 50) return { state: "Warning", label: "주의" };
        return { state: "Error", label: "위험" };
      }
      // equity ratio
      if (val >= 50) return { state: "Success", label: "양호" };
      if (val >= 30) return { state: "Warning", label: "주의" };
      return { state: "Error", label: "위험" };
    }

    function _sumTrend(aRaw, sAmtKey) {
      var asset = 0,
        liab = 0,
        equity = 0;
      aRaw.forEach(function (r) {
        var cls = CLASS_MAP[r.MinorClass];
        if (!cls) return;
        var amt = parseFloat(r[sAmtKey]) || 0;
        // 대변 정상 계정(부채·자본·수익)은 OData 부호에 무관하게 양수로 통일
        if (
          r.MajorClass === "2" ||
          r.MajorClass === "3" ||
          r.MajorClass === "4"
        ) {
          amt = Math.abs(amt);
        }
        if (cls.sec === "asset") asset += amt;
        if (cls.sec === "liab") liab += amt;
        if (cls.sec === "equity") equity += amt;
      });
      var diff = asset - (liab + equity);
      if (Math.abs(diff) >= 1) equity += diff;
      return { asset: _toOk(asset), liab: _toOk(liab), equity: _toOk(equity) };
    }

    // ── buildTreeData: Flat Array → [대분류 > 중분류 > 계정] 3단계 Tree ───────────
    // Map 기반 O(n) 단일 순회 + 자동 롤업(Roll-up)
    // BS 계정(MajorClass 1·2·3)만 처리하며 CLASS_MAP 재활용
    function buildTreeData(aRaw) {
      var MAJOR_ORDER = { 1: 1, 2: 2, 3: 3 };
      var MAJOR_LABEL = { 1: "자산", 2: "부채", 3: "자본" };
      var mMajor = {}; // { "1": { ...대분류 노드, _sort, _minors:{...} } }

      // ── Pass 1: 단일 순회 → Map 구축 + 롤업 ───────────────────────
      aRaw.forEach(function (r) {
        var sMaj = String(r.MajorClass || "");
        if (!MAJOR_ORDER[sMaj]) return; // BS 계정만
        var cls = CLASS_MAP[r.MinorClass]; // 기존 CLASS_MAP 재활용
        if (!cls) return;

        var isCredit = sMaj === "2" || sMaj === "3";
        var nCurr = isCredit
          ? Math.abs(parseFloat(r.CurrAmt) || 0)
          : parseFloat(r.CurrAmt) || 0;
        var nPrev = isCredit
          ? Math.abs(parseFloat(r.PrevAmt) || 0)
          : parseFloat(r.PrevAmt) || 0;

        if (!mMajor[sMaj]) {
          mMajor[sMaj] = {
            label: MAJOR_LABEL[sMaj],
            _lvl: 0,
            currAmt: 0,
            prevAmt: 0,
            _sort: MAJOR_ORDER[sMaj],
            _minors: {},
          };
        }
        var oMaj = mMajor[sMaj];

        var sMin = String(r.MinorClass);
        if (!oMaj._minors[sMin]) {
          oMaj._minors[sMin] = {
            label: cls.roman + ".  " + cls.lv2,
            _lvl: 1,
            currAmt: 0,
            prevAmt: 0,
            _sort: cls.sort,
            children: [],
          };
        }
        var oMin = oMaj._minors[sMin];

        oMin.children.push({
          label: (r.Stext || r.Saknr || "").trim(),
          _lvl: 2,
          currAmt: nCurr,
          prevAmt: nPrev,
          currFmt: _fmt(nCurr),
          prevFmt: _fmt(nPrev),
          currKpi: nCurr ? _fmtKpi(nCurr) : "—",
          prevKpi: nPrev ? _fmtKpi(nPrev) : "—",
          children: [],
        });

        oMin.currAmt += nCurr;
        oMin.prevAmt += nPrev;
        oMaj.currAmt += nCurr;
        oMaj.prevAmt += nPrev;
      });

      // ── Pass 2: Map → 정렬된 Array, 임시 키 제거 ─────────────────
      return Object.keys(mMajor)
        .sort(function (a, b) {
          return mMajor[a]._sort - mMajor[b]._sort;
        })
        .map(function (sMaj) {
          var oMaj = mMajor[sMaj];
          oMaj.children = Object.keys(oMaj._minors)
            .sort(function (a, b) {
              return oMaj._minors[a]._sort - oMaj._minors[b]._sort;
            })
            .map(function (sMin) {
              var oMin = oMaj._minors[sMin];
              oMin.children.sort(function (a, b) {
                return a.label < b.label ? -1 : 1;
              });
              oMin.currFmt = _fmt(oMin.currAmt);
              oMin.prevFmt = _fmt(oMin.prevAmt);
              oMin.currKpi = oMin.currAmt ? _fmtKpi(oMin.currAmt) : "—";
              oMin.prevKpi = oMin.prevAmt ? _fmtKpi(oMin.prevAmt) : "—";
              delete oMin._sort;
              return oMin;
            });
          oMaj.currFmt = _fmt(oMaj.currAmt);
          oMaj.prevFmt = _fmt(oMaj.prevAmt);
          oMaj.currKpi = oMaj.currAmt ? _fmtKpi(oMaj.currAmt) : "—";
          oMaj.prevKpi = oMaj.prevAmt ? _fmtKpi(oMaj.prevAmt) : "—";
          delete oMaj._minors;
          delete oMaj._sort;
          return oMaj;
        });
    }

    return Controller.extend(
      "zpe3.fi.financial.zpe3fifinancial.controller.FinancialView",
      {
        onInit: function () {
          var y = new Date().getFullYear();
          this.getView().setModel(
            new JSONModel({
              busy: false,
              hasData: false,
              hasTrend: false,
              showApprox: false,
              bukrs: "1000",
              gjahr: String(y),
              prevYear: String(y - 1),
              years: this._buildYears(y),
              rows: [],
              displayRows: [],
              plRows: [],
              cfRows: [],
              donutFilterLabel: "",
              hasInvent: false,
              inventData: [],
              kpiAsset: "0",
              kpiLiab: "0",
              kpiEquity: "0",
              sumAssetFmt: "0",
              sumLiabFmt: "0",
              sumEquityFmt: "0",
              sumLiabEqFmt: "0",
              nwcFmt: "0",
              kpiNwc: "0",
              nwcSign: true,
              assetDonutData: [],
              liabDonutData: [],
              assetDeltaText: "-",
              assetDeltaPos: null,
              liabDeltaText: "-",
              liabDeltaPos: null,
              equityDeltaText: "-",
              equityDeltaPos: null,
              balanced: true,
              compChartData: [],
              assetChartData: [],
              liabChartData: [],
              ratio: {
                currRatioC: "-",
                currRatioP: "-",
                currState: { state: "None", label: "-" },
                debtRatioC: "-",
                debtRatioP: "-",
                debtState: { state: "None", label: "-" },
                eqRatioC: "-",
                eqRatioP: "-",
                eqState: { state: "None", label: "-" },
                quickRatioC: "-",
                quickRatioP: "-",
                quickState: { state: "None", label: "-" },
              },
              trendData: [],
              trendYearRange: "",
              grirAlert: false,
              grirAmtFmt: "",
              activeTab: "bs",
              ai: { visible: false, busy: false, html: "", collapsed: false },
              pl: {
                revenue: 0,
                revenueFmt: "0",
                revenueKpi: "0",
                opIncome: 0,
                opIncomeFmt: "0",
                opIncomeKpi: "0",
                netIncome: 0,
                netIncomeFmt: "0",
                netIncomeKpi: "0",
                opMargin: "0.0%",
                opMarginPrev: "0.0%",
                cogsRatio: "0.0%",
                cogsRatioPrev: "0.0%",
                revDelta: { text: "-", pos: null },
                opDelta: { text: "-", pos: null },
                netDelta: { text: "-", pos: null },
                marginDelta: { text: "-", pos: null },
                cogsRatioDelta: { text: "-", pos: null },
                waterfallData: [],
                comboData: [],
              },
              cf: {
                operating: 0,
                operatingFmt: "0",
                operatingKpi: "0",
                investing: 0,
                investingFmt: "0",
                investingKpi: "0",
                financing: 0,
                financingFmt: "0",
                financingKpi: "0",
                fcf: 0,
                fcfFmt: "0",
                fcfKpi: "0",
                ebitda: 0,
                ebitdaFmt: "0",
                ebitdaKpi: "0",
                ocfMargin: 0,
                ocfMarginFmt: "0.0%",
                waterfallData: [],
                stackedData: [],
              },
            }),
            "view",
          );

          this.getView().setModel(
            new JSONModel({ bsTree: [], plTree: [], cfTree: [] }),
            "tree",
          );

          this._aiCache = {}; // { "bukrs_gjahr": htmlString }

          this.getOwnerComponent()
            .getModel()
            .metadataLoaded()
            .then(
              function () {
                this._load();
              }.bind(this),
            );
        },

        _buildYears: function (n) {
          var a = [];
          for (var i = n; i >= 2018; i--) {
            a.push({ key: String(i), text: i + "년" });
          }
          return a;
        },

        onYearChange: function (oEvent) {
          var y = parseInt(oEvent.getSource().getSelectedKey(), 10);
          var oVM = this.getView().getModel("view");
          oVM.setProperty("/gjahr", String(y));
          oVM.setProperty("/prevYear", String(y - 1));
          this._syncAiCache(String(y), oVM.getProperty("/bukrs"), oVM);
          this._load();
        },

        onSearch: function () {
          var oVM = this.getView().getModel("view");
          this._syncAiCache(
            oVM.getProperty("/gjahr"),
            oVM.getProperty("/bukrs"),
            oVM,
          );
          this._load();
        },

        _syncAiCache: function (sGjahr, sBukrs, oVM) {
          var sKey = sBukrs + "_" + sGjahr;
          var sCached = this._aiCache && this._aiCache[sKey];
          if (sCached) {
            oVM.setProperty("/ai/visible", true);
            oVM.setProperty("/ai/html", sCached);
            oVM.setProperty("/ai/busy", false);
            oVM.setProperty("/ai/collapsed", false);
          } else {
            oVM.setProperty("/ai/visible", false);
            oVM.setProperty("/ai/html", "");
            oVM.setProperty("/ai/busy", false);
          }
        },

        _load: function () {
          var oVM = this.getView().getModel("view");
          var y = oVM.getProperty("/gjahr");
          var b = oVM.getProperty("/bukrs");

          if (!b) {
            MessageBox.warning("회사코드를 입력하세요.");
            return;
          }
          if (!y) {
            MessageBox.warning("회계연도를 선택하세요.");
            return;
          }
          if (parseInt(y, 10) < 2018) {
            MessageBox.warning(
              "회사 설립연도(2018년) 이전은 조회할 수 없습니다.",
            );
            return;
          }

          oVM.setProperty("/busy", true);
          oVM.setProperty("/hasData", false);
          oVM.setProperty("/hasTrend", false);

          var MIN_YEAR = 2018;
          var iYear = parseInt(y, 10);
          var oModel = this.getOwnerComponent().getModel();

          // 2018년부터 선택 연도까지 2년 단위 쌍 구성
          // 예) 2026 선택 → [(2026,2025),(2024,2023),(2022,2021),(2020,2019),(2018,2017)]
          var aPairs = [];
          for (var nY = iYear; nY >= MIN_YEAR; nY -= 2) {
            aPairs.push({ curr: nY, prev: nY - 1 });
          }

          var aResults = aPairs.map(function () {
            return null;
          });
          var nDone = 0;
          var bFatal = false;
          var self = this;

          var fnDone = function () {
            nDone++;
            if (nDone < aPairs.length) return;
            oVM.setProperty("/busy", false);
            if (bFatal || !aResults[0] || !aResults[0].length) {
              oVM.setProperty("/hasData", false);
              return;
            }
            self._process(aResults[0], iYear, aPairs, aResults, oVM);
          };

          aPairs.forEach(function (pair, idx) {
            var sFilter =
              "Bukrs eq '" +
              b +
              "'" +
              " and Gjahr eq '" +
              String(pair.curr) +
              "'";
            oModel.read("/FinancialSet", {
              urlParameters: { $filter: sFilter },
              success: function (d) {
                aResults[idx] = d.results || [];
                fnDone();
              },
              error: function (e) {
                aResults[idx] = [];
                if (idx === 0) {
                  bFatal = true;
                  var m = e.message;
                  try {
                    m = JSON.parse(e.responseText).error.message.value;
                  } catch (x) {}
                  MessageBox.error("조회 오류: " + m);
                }
                fnDone();
              },
            });
          });
        },

        _process: function (aRaw, iYear, aPairs, aResults, oVM) {
          var G = { asset: {}, liab: {}, equity: {} };
          var nA_C = 0,
            nA_P = 0;
          var nL_C = 0,
            nL_P = 0;
          var nE_C = 0,
            nE_P = 0;

          aRaw.forEach(function (r) {
            var cls = CLASS_MAP[r.MinorClass];
            if (!cls) return;

            var c = parseFloat(r.CurrAmt) || 0;
            var p = parseFloat(r.PrevAmt) || 0;

            // 대변 정상 계정(부채·자본·수익)은 OData 부호에 무관하게 양수로 통일
            if (
              r.MajorClass === "2" ||
              r.MajorClass === "3" ||
              r.MajorClass === "4"
            ) {
              c = Math.abs(c);
              p = Math.abs(p);
            }

            var k = cls.sort;
            if (!G[cls.sec][k]) {
              G[cls.sec][k] = {
                roman: cls.roman,
                lv2: cls.lv2,
                items: [],
                stC: 0,
                stP: 0,
              };
            }
            G[cls.sec][k].items.push({ stext: r.Stext, c: c, p: p });
            G[cls.sec][k].stC += c;
            G[cls.sec][k].stP += p;

            if (cls.sec === "asset") {
              nA_C += c;
              nA_P += p;
            }
            if (cls.sec === "liab") {
              nL_C += c;
              nL_P += p;
            }
            if (cls.sec === "equity") {
              nE_C += c;
              nE_P += p;
            }
          });

          // 대차 자동 조정
          var rawDiff = nA_C - (nL_C + nE_C);
          if (Math.abs(rawDiff) >= 1) nE_C += rawDiff;

          // 테이블 행 구성
          var rows = [];
          var pushSection = function (title, secKey, totalC, totalP) {
            rows.push({
              level: "section",
              highlight: "None",
              label: title,
              currFmt: "",
              prevFmt: "",
              currRaw: totalC,
              prevRaw: totalP,
            });
            Object.keys(G[secKey])
              .sort()
              .forEach(function (k) {
                var g = G[secKey][k];
                g.items.sort(function (a, b) {
                  return a.stext < b.stext ? -1 : 1;
                });
                rows.push({
                  level: "group",
                  highlight: "Information",
                  label: g.roman + ".  " + g.lv2,
                  currFmt: "",
                  prevFmt: "",
                  currRaw: g.stC,
                  prevRaw: g.stP,
                });
                var bSingleSame =
                  g.items.length === 1 && g.items[0].stext === g.lv2;
                if (!bSingleSame) {
                  g.items.forEach(function (it) {
                    rows.push({
                      level: "item",
                      highlight: "None",
                      label: it.stext,
                      currFmt: "",
                      prevFmt: "",
                      currRaw: it.c,
                      prevRaw: it.p,
                    });
                  });
                }
              });
            rows.push({
              level: "total",
              highlight: "Information",
              label: title + " 합계",
              currFmt: "",
              prevFmt: "",
              currRaw: totalC,
              prevRaw: totalP,
            });
          };
          pushSection("자산", "asset", nA_C, nA_P);
          pushSection("부채", "liab", nL_C, nL_P);
          pushSection("자본", "equity", nE_C, nE_P);
          rows.push({
            level: "grand",
            highlight: "Success",
            label: "부채 및 자본 총계",
            currFmt: "",
            prevFmt: "",
            currRaw: nL_C + nE_C,
            prevRaw: nL_P + nE_P,
          });

          var nDiv = 1;
          var _fmtRaw = function (v) {
            if (!v) return "-";
            var n = Math.round(v / nDiv);
            if (n < 0) return "-" + Math.abs(n).toLocaleString("ko-KR");
            return n.toLocaleString("ko-KR");
          };
          var _fmtKpiSigned = function (v) {
            if (!v) return "—";
            return (
              (v < 0 ? "(" : "") + _fmtKpi(Math.abs(v)) + (v < 0 ? ")" : "")
            );
          };
          rows.forEach(function (r) {
            r.currFmt = _fmtRaw(r.currRaw);
            r.prevFmt = _fmtRaw(r.prevRaw);
            r.currKpi = _fmtKpiSigned(r.currRaw);
            r.prevKpi = _fmtKpiSigned(r.prevRaw);
          });

          // 차트 데이터
          var compChartData = [
            { category: "자산 총계", curr: _toOk(nA_C), prev: _toOk(nA_P) },
            { category: "부채 총계", curr: _toOk(nL_C), prev: _toOk(nL_P) },
            { category: "자본 총계", curr: _toOk(nE_C), prev: _toOk(nE_P) },
          ];
          var assetChartData = Object.keys(G.asset)
            .sort()
            .map(function (k) {
              return {
                category: G.asset[k].lv2,
                curr: _toOk(G.asset[k].stC),
                prev: _toOk(G.asset[k].stP),
              };
            });
          var liabChartData = Object.keys(G.liab)
            .sort()
            .map(function (k) {
              return {
                category: G.liab[k].lv2,
                curr: _toOk(G.liab[k].stC),
                prev: _toOk(G.liab[k].stP),
              };
            });

          // Delta
          var aDelta = _fmtDelta(nA_C, nA_P);
          var lDelta = _fmtDelta(nL_C, nL_P);
          var eDelta = _fmtDelta(nE_C, nE_P);

          // ── 재무 비율 계산 ──────────────────────────────────────
          var nCA_C = G.asset[1] ? G.asset[1].stC : 0; // 유동자산 당기
          var nCA_P = G.asset[1] ? G.asset[1].stP : 0; // 유동자산 전기
          var nCL_C = G.liab[1] ? G.liab[1].stC : 0; // 유동부채 당기
          var nCL_P = G.liab[1] ? G.liab[1].stP : 0; // 유동부채 전기

          var currRatioC = nCL_C !== 0 ? (nCA_C / nCL_C) * 100 : null;
          var currRatioP = nCL_P !== 0 ? (nCA_P / nCL_P) * 100 : null;
          var debtRatioC = nE_C !== 0 ? (nL_C / nE_C) * 100 : null;
          var debtRatioP = nE_P !== 0 ? (nL_P / nE_P) * 100 : null;
          var eqRatioC = nA_C !== 0 ? (nE_C / nA_C) * 100 : null;
          var eqRatioP = nA_P !== 0 ? (nE_P / nA_P) * 100 : null;

          // ── 순운전자본 ────────────────────────────────────────────
          var nNwc_C = nCA_C - nCL_C;
          var nNwc_P = nCA_P - nCL_P;

          // ── 당좌비율 (유동자산 - 재고성 계정 총액) ───────────────
          // 재고 본계정(+)과 평가충당금(-)이 동시에 키워드에 매칭되면
          // 합산 시 net=0 이 되어 당좌=유동 현상이 발생하므로
          // 양수(본계정) 항목만 합산 → contra account 제외
          var INVENT_KW = [
            "재고",
            "상품",
            "제품",
            "원재료",
            "원자재",
            "반제품",
            "재공품",
            "저장품",
            "부재료",
            "완제품",
          ];
          var nInvent_C = 0,
            nInvent_P = 0;
          if (G.asset[1]) {
            G.asset[1].items.forEach(function (it) {
              var sNm = (it.stext || "").trim();
              var bInv = INVENT_KW.some(function (kw) {
                return sNm.indexOf(kw) >= 0;
              });
              if (bInv) {
                if (it.c > 0) nInvent_C += it.c;
                if (it.p > 0) nInvent_P += it.p;
              }
            });
          }
          var nQA_C = Math.min(Math.max(nCA_C - nInvent_C, 0), nCA_C);
          var nQA_P = Math.min(Math.max(nCA_P - nInvent_P, 0), nCA_P);
          var quickRatioC = nCL_C !== 0 ? (nQA_C / nCL_C) * 100 : null;
          var quickRatioP = nCL_P !== 0 ? (nQA_P / nCL_P) * 100 : null;

          // ── 세부 구성 도넛 데이터 (5% 미만 항목은 "기타"로 통합) ─
          var _trunc = function (s) {
            return s.length > 14 ? s.slice(0, 13) + "…" : s;
          };
          var _buildDonutData = function (items) {
            var pos = items.filter(function (it) {
              return it.c > 0;
            });
            var total = pos.reduce(function (s, it) {
              return s + it.c;
            }, 0);
            if (total === 0) return [];
            pos.sort(function (a, b) {
              return b.c - a.c;
            });
            var main = [],
              otherSum = 0;
            pos.forEach(function (it) {
              if (it.c / total >= 0.05) {
                main.push({ label: _trunc(it.stext), val: _toOk(it.c) });
              } else {
                otherSum += it.c;
              }
            });
            if (otherSum > 0)
              main.push({ label: "기타", val: _toOk(otherSum) });
            return main;
          };
          var assetDonutData = G.asset[1]
            ? _buildDonutData(G.asset[1].items)
            : [];
          var liabDonutData = G.liab[1] ? _buildDonutData(G.liab[1].items) : [];

          // ── GR/IR 미반제 잔액 감지 ──────────────────────────────
          var GR_KW = ["gr/ir", "미결입금", "매입미결"];
          var nGrir_C = 0;
          ["asset", "liab"].forEach(function (sec) {
            Object.keys(G[sec]).forEach(function (k) {
              G[sec][k].items.forEach(function (it) {
                var nm = (it.stext || "").toLowerCase();
                if (
                  GR_KW.some(function (kw) {
                    return nm.indexOf(kw) >= 0;
                  })
                ) {
                  nGrir_C += Math.abs(it.c);
                }
              });
            });
          });
          var bGrirAlert = nGrir_C > 0;

          // ── 추세 데이터 (2018년~선택연도 전체) ─────────────────
          // aPairs: [{curr:Y, prev:Y-1}, {curr:Y-2, prev:Y-3}, ...]
          // 각 쌍의 curr_amt/prev_amt 를 _sumTrend 로 추출 후 연도별로 정렬
          var MIN_YEAR_TREND = 2018;
          var aTrendPoints = [];

          aPairs.forEach(function (pair, idx) {
            var aRawI = aResults[idx];
            if (!aRawI || !aRawI.length) return;

            var tCurr = _sumTrend(aRawI, "CurrAmt");
            aTrendPoints.push({
              y: pair.curr,
              asset: tCurr.asset,
              liab: tCurr.liab,
              equity: tCurr.equity,
            });

            if (pair.prev >= MIN_YEAR_TREND) {
              var tPrev = _sumTrend(aRawI, "PrevAmt");
              aTrendPoints.push({
                y: pair.prev,
                asset: tPrev.asset,
                liab: tPrev.liab,
                equity: tPrev.equity,
              });
            }
          });

          // 연도 오름차순 정렬 후 row 변환
          aTrendPoints.sort(function (a, b) {
            return a.y - b.y;
          });
          var trendData = aTrendPoints.map(function (tp) {
            return {
              year: String(tp.y) + "년",
              asset: tp.asset,
              liab: tp.liab,
              equity: tp.equity,
            };
          });

          var bHasTrend = trendData.length >= 3;
          var sTrendRange =
            trendData[0].year + " ~ " + trendData[trendData.length - 1].year;

          // ── ViewModel 업데이트 ──────────────────────────────────
          var gjahr = String(iYear);
          var prevYear = String(iYear - 1);

          oVM.setProperty("/rows", rows);
          oVM.setProperty("/displayRows", rows.slice());
          oVM.setProperty("/donutFilterLabel", "");

          // ── 재고 카테고리별 비교 차트 ─────────────────────────────
          var INVENT_CAT = [
            { key: "원재료", kw: ["원재료", "원자재"] },
            { key: "제품", kw: ["제품", "완제품"] },
            { key: "저장품", kw: ["저장품", "부재료"] },
          ];
          var inventData = [];
          if (G.asset[1]) {
            INVENT_CAT.forEach(function (cat) {
              var cSum = 0,
                pSum = 0;
              G.asset[1].items.forEach(function (it) {
                var nm = (it.stext || "").trim();
                var hit = cat.kw.some(function (kw) {
                  return nm.indexOf(kw) >= 0;
                });
                if (hit && it.c > 0) cSum += it.c;
                if (hit && it.p > 0) pSum += it.p;
              });
              if (cSum > 0 || pSum > 0) {
                inventData.push({
                  cat: cat.key,
                  curr: _toOk(cSum),
                  prev: _toOk(pSum),
                });
              }
            });
          }
          oVM.setProperty("/inventData", inventData);
          oVM.setProperty("/hasInvent", inventData.length > 0);

          oVM.setProperty("/kpiAsset", _fmtKpi(nA_C));
          oVM.setProperty("/kpiLiab", _fmtKpi(nL_C));
          oVM.setProperty("/kpiEquity", _fmtKpi(nE_C));
          oVM.setProperty("/sumAssetFmt", _fmt(nA_C));
          oVM.setProperty("/sumLiabFmt", _fmt(nL_C));
          oVM.setProperty("/sumEquityFmt", _fmt(nE_C));
          oVM.setProperty("/sumLiabEqFmt", _fmt(nL_C + nE_C));
          oVM.setProperty("/assetDeltaText", aDelta.text);
          oVM.setProperty("/assetDeltaPos", aDelta.pos);
          oVM.setProperty("/liabDeltaText", lDelta.text);
          oVM.setProperty("/liabDeltaPos", lDelta.pos);
          oVM.setProperty("/equityDeltaText", eDelta.text);
          oVM.setProperty("/equityDeltaPos", eDelta.pos);
          oVM.setProperty("/balanced", Math.abs(nA_C - (nL_C + nE_C)) < 1);
          oVM.setProperty("/compChartData", compChartData);
          oVM.setProperty("/assetChartData", assetChartData);
          oVM.setProperty("/liabChartData", liabChartData);
          oVM.setProperty("/nwcFmt", _fmt(nNwc_C));
          oVM.setProperty("/kpiNwc", _fmtKpi(nNwc_C));
          oVM.setProperty("/nwcSign", nNwc_C >= 0);
          oVM.setProperty("/assetDonutData", assetDonutData);
          oVM.setProperty("/liabDonutData", liabDonutData);
          oVM.setProperty("/ratio", {
            currRatioC: _fmtRatio(currRatioC),
            currRatioP: _fmtRatio(currRatioP),
            currState: _ratioState("current", currRatioC),
            debtRatioC: _fmtRatio(debtRatioC),
            debtRatioP: _fmtRatio(debtRatioP),
            debtState: _ratioState("debt", debtRatioC),
            eqRatioC: _fmtRatio(eqRatioC),
            eqRatioP: _fmtRatio(eqRatioP),
            eqState: _ratioState("equity", eqRatioC),
            quickRatioC: _fmtRatio(quickRatioC),
            quickRatioP: _fmtRatio(quickRatioP),
            quickState: _ratioState("quick", quickRatioC),
          });
          oVM.setProperty("/trendData", trendData);
          oVM.setProperty("/hasTrend", bHasTrend);
          oVM.setProperty("/trendYearRange", sTrendRange);
          oVM.setProperty("/grirAlert", bGrirAlert);
          oVM.setProperty("/grirAmtFmt", bGrirAlert ? _fmtKpi(nGrir_C) : "");
          oVM.setProperty("/hasData", true);

          this._processPL(aRaw, gjahr, prevYear, oVM);
          this._processCF(aRaw, gjahr, oVM, aResults[1] || []);
          this._applyVizProps(gjahr, prevYear);
          this._applyDonutProps();
          if (bHasTrend) this._applyTrendVizProps();
          if (inventData.length > 0) this._applyInventVizProps();
          this._applyPlVizProps(gjahr, prevYear);
          this._applyCfVizProps(gjahr);

          // ── BS 트리 생성 + 연도 변경 시 접힌 상태 초기화 ─────────
          var aBsTree = buildTreeData(aRaw);
          this.getView().getModel("tree").setProperty("/bsTree", aBsTree);
          var oView = this.getView();
          var self = this;
          ["idBsTreeTable", "idPlTreeTable", "idCfTreeTable"].forEach(
            function (sId) {
              var oTbl = oView.byId(sId);
              if (!oTbl) return;
              oTbl.collapseAll();
              oTbl.expandToLevel(1); // 1레벨(대분류)만 기본 펼침
              self._syncTableHeight(oTbl);
            },
          );
        },

        _applyVizProps: function (gjahr, prevYear) {
          var aIds = ["idCompChart", "idAssetChart", "idLiabChart"];
          var aTitles = [
            "자산 · 부채 · 자본  당기 / 전기 비교",
            "자산 구성  당기 / 전기 비교",
            "부채 구성  당기 / 전기 비교",
          ];
          aIds.forEach(
            function (sId, i) {
              var oViz = this.getView().byId(sId);
              if (!oViz) return;
              oViz.setVizProperties({
                title: { visible: false, text: aTitles[i] },
                plotArea: {
                  colorPalette: ["#1565c0", "#7db9e8"],
                  drawingEffect: "glossy",
                  dataLabel: {
                    visible: true,
                    formatString: "#,##0.0",
                    style: { fontSize: "11px", fontWeight: "bold" },
                  },
                  gap: { barSpacing: 0.3 },
                },
                legend: {
                  title: { visible: false },
                  position: "bottom",
                  label: {
                    text: [gjahr + "년 (당기)", prevYear + "년 (전기)"],
                    style: { fontSize: "12px", fontWeight: "bold" },
                  },
                },
                tooltip: {
                  visible: true,
                  bodyDimensionLabel: { visible: true },
                  bodyDimensionValue: { visible: true },
                  bodyMeasureValue: { visible: true, formatString: "#,##0.0" },
                },
                valueAxis: {
                  title: { visible: true, text: "억원" },
                  label: {
                    formatString: "#,##0.0",
                    style: { fontWeight: "bold" },
                  },
                },
                categoryAxis: { title: { visible: false } },
              });
            }.bind(this),
          );
        },

        _applyTrendVizProps: function () {
          var oViz = this.getView().byId("idTrendChart");
          if (!oViz) return;
          oViz.setVizProperties({
            title: { visible: false },
            plotArea: {
              colorPalette: ["#1565c0", "#c62828", "#2e7d32"],
              dataLabel: { visible: false },
              line: { marker: { visible: true, size: 8 } },
            },
            legend: {
              title: { visible: false },
              position: "bottom",
              label: { style: { fontSize: "12px", fontWeight: "bold" } },
            },
            tooltip: {
              visible: true,
              bodyMeasureValue: { visible: true, formatString: "#,##0.0" },
            },
            valueAxis: {
              title: { visible: true, text: "억원" },
              label: { formatString: "#,##0.0", style: { fontWeight: "bold" } },
            },
            categoryAxis: { title: { visible: false } },
          });
        },

        _applyDonutProps: function () {
          var that = this;
          ["idAssetDonut", "idLiabDonut"].forEach(function (sId) {
            var oViz = that.getView().byId(sId);
            if (!oViz) return;
            oViz.setVizProperties({
              title: { visible: false },
              legend: {
                visible: true,
                position: "bottom",
                label: { style: { fontSize: "12px", fontWeight: "bold" } },
              },
              plotArea: {
                colorPalette: [
                  "#1565c0",
                  "#2e7d32",
                  "#c62828",
                  "#7b1fa2",
                  "#e65100",
                  "#0277bd",
                  "#00838f",
                  "#f57f17",
                ],
                drawingEffect: "glossy",
                dataLabel: {
                  visible: true,
                  type: "percentage",
                  formatString: "#,##0.0%",
                  hideWhenOverlap: true,
                  style: { fontSize: "11px", fontWeight: "bold" },
                },
              },
              tooltip: {
                visible: true,
                formatString: { "금액(억원)": "#,##0.00" },
              },
            });

            // 기존 이벤트 핸들러 중복 방지 후 재등록
            oViz.detachSelectData(that._onDonutSelect, that);
            oViz.detachDeselectData(that._onDonutDeselect, that);
            oViz.attachSelectData(that._onDonutSelect, that);
            oViz.attachDeselectData(that._onDonutDeselect, that);
          });
        },

        _onDonutSelect: function (oEvent) {
          var aData = oEvent.getParameter("data");
          if (!aData || !aData.length) return;
          var sLabel = aData[0].data["계정"];
          var sId = oEvent.getSource().getId();
          var bIsAsset = sId.indexOf("AssetDonut") >= 0;
          this._filterTableByDonut(sLabel, bIsAsset);
        },

        _onDonutDeselect: function () {
          this._clearDonutFilter();
        },

        _filterTableByDonut: function (sTruncLabel, bIsAsset) {
          var oVM = this.getView().getModel("view");
          if (sTruncLabel === "기타") {
            // "기타" 클릭 시 필터 해제
            this._clearDonutFilter();
            return;
          }
          var allRows = oVM.getProperty("/rows") || [];
          var sSection = bIsAsset ? "자산" : "부채";
          var sGroupKw = bIsAsset ? "유동자산" : "유동부채";
          var filtered = allRows.filter(function (r) {
            if (r.level === "section") return r.label === sSection;
            if (r.level === "group") return r.label.indexOf(sGroupKw) >= 0;
            if (r.level === "item") {
              var trunc =
                r.label.length > 14 ? r.label.slice(0, 13) + "…" : r.label;
              return trunc === sTruncLabel || r.label === sTruncLabel;
            }
            if (r.level === "total") return r.label.indexOf(sSection) >= 0;
            return false;
          });
          oVM.setProperty("/displayRows", filtered);
          oVM.setProperty("/donutFilterLabel", sTruncLabel);
        },

        _clearDonutFilter: function () {
          var oVM = this.getView().getModel("view");
          oVM.setProperty(
            "/displayRows",
            (oVM.getProperty("/rows") || []).slice(),
          );
          oVM.setProperty("/donutFilterLabel", "");
        },

        _applyInventVizProps: function () {
          var oViz = this.getView().byId("idInventChart");
          if (!oViz) return;
          var oVM = this.getView().getModel("view");
          var gjahr = oVM.getProperty("/gjahr");
          var prevYear = oVM.getProperty("/prevYear");
          oViz.setVizProperties({
            title: { visible: false },
            plotArea: {
              colorPalette: ["#1565c0", "#7db9e8"],
              drawingEffect: "glossy",
              dataLabel: {
                visible: true,
                formatString: "#,##0.00",
                style: { fontSize: "11px", fontWeight: "bold" },
              },
              gap: { barSpacing: 0.25 },
            },
            legend: {
              title: { visible: false },
              position: "bottom",
              label: {
                text: [gjahr + "년 (당기)", prevYear + "년 (전기)"],
                style: { fontSize: "12px", fontWeight: "bold" },
              },
            },
            tooltip: {
              visible: true,
              bodyMeasureValue: { visible: true, formatString: "#,##0.0" },
            },
            valueAxis: {
              title: { visible: true, text: "억원" },
              label: { formatString: "#,##0.0", style: { fontWeight: "bold" } },
            },
            categoryAxis: { title: { visible: false } },
          });
        },

        onTabSelect: function (oEvent) {
          var sKey = oEvent.getParameter("selectedKey");
          this.getView().getModel("view").setProperty("/activeTab", sKey);
        },

        onBsExpandAll: function () {
          var t = this.getView().byId("idBsTreeTable");
          t.expandToLevel(99);
          this._syncTableHeight(t);
        },
        onBsCollapseAll: function () {
          var t = this.getView().byId("idBsTreeTable");
          t.collapseAll();
          this._syncTableHeight(t);
        },
        onPlExpandAll: function () {
          var t = this.getView().byId("idPlTreeTable");
          t.expandToLevel(99);
          this._syncTableHeight(t);
        },
        onPlCollapseAll: function () {
          var t = this.getView().byId("idPlTreeTable");
          t.collapseAll();
          this._syncTableHeight(t);
        },
        onCfExpandAll: function () {
          var t = this.getView().byId("idCfTreeTable");
          t.expandToLevel(99);
          this._syncTableHeight(t);
        },
        onCfCollapseAll: function () {
          var t = this.getView().byId("idCfTreeTable");
          t.collapseAll();
          this._syncTableHeight(t);
        },

        // ── toggleOpenState 핸들러: 노드 펼침/접힘 시 테이블 높이 자동 조절 ──
        onBsToggle: function (oEvent) {
          this._syncTableHeight(oEvent.getSource());
        },
        onPlToggle: function (oEvent) {
          this._syncTableHeight(oEvent.getSource());
        },
        onCfToggle: function (oEvent) {
          this._syncTableHeight(oEvent.getSource());
        },

        // binding.getLength() = 현재 화면에 보여야 할 행 수(펼쳐진 상태 반영)
        // setTimeout(0): expand 처리 완료 후 길이를 읽기 위해
        _syncTableHeight: function (oTable) {
          setTimeout(function () {
            var oBinding = oTable && oTable.getBinding("rows");
            if (!oBinding) return;
            oTable.setVisibleRowCount(Math.max(oBinding.getLength(), 3));
          }, 0);
        },

        _treeToFlatRows: function (aTree) {
          var aRows = [];
          var visit = function (nodes, depth) {
            (nodes || []).forEach(function (n, idx) {
              var sLevel;
              if (depth === 0) {
                if (n.isCalc && n.children && n.children.length) {
                  sLevel = "section"; // 영업활동 등 — 합계 & 하위항목 있는 상위 섹션
                } else if (n.isCalc && idx === nodes.length - 1) {
                  sLevel = "grand"; // 당기순이익, 현금의 증감 등 최종 합계
                } else if (n.isCalc) {
                  sLevel = "total"; // 매출총이익, 영업이익 등 중간 소계
                } else {
                  sLevel = "section"; // 매출액, 매출원가, 투자활동 등 비계산 최상위 항목
                }
              } else {
                sLevel = n.isGroup ? "group" : "item";
              }
              aRows.push({
                label: n.label,
                level: sLevel,
                currFmt: n.currFmt,
                prevFmt: n.prevFmt,
                currKpi: n.currKpi || "—",
                prevKpi: n.prevKpi || "—",
              });
              if (n.children && n.children.length) {
                visit(n.children, depth + 1);
              }
            });
          };
          visit(aTree, 0);
          return aRows;
        },

        onAiReport: function () {
          var oVM = this.getView().getModel("view");
          if (!oVM.getProperty("/hasData")) return;

          var b = oVM.getProperty("/bukrs");
          var y = oVM.getProperty("/gjahr");

          oVM.setProperty("/ai/visible", true);
          oVM.setProperty("/ai/busy", true);
          oVM.setProperty("/ai/html", "");
          oVM.setProperty("/ai/collapsed", false);
          this.getView().byId("page").scrollTo(0, 400);

          this.getOwnerComponent()
            .getModel()
            .callFunction("/GenerateAiReport", {
              method: "GET",
              urlParameters: { Bukrs: b, Gjahr: y },
              success: function (oData) {
                console.log("🎯 백엔드에서 넘어온 AI 응답 데이터:", oData);

                var sText = "";
                if (oData) {
                  if (oData.ReportText) {
                    sText = oData.ReportText;
                  } else if (oData.Reporttext) {
                    sText = oData.Reporttext;
                  } else if (oData.GenerateAiReport) {
                    sText =
                      oData.GenerateAiReport.ReportText ||
                      oData.GenerateAiReport.Reporttext ||
                      "";
                  }
                }

                if (!sText) {
                  MessageBox.warning(
                    "데이터는 수신했으나 리포트 텍스트(ReportText)를 찾을 수 없습니다. F12 콘솔을 확인해주세요.",
                  );
                }

                var sHtml = this._parseAiText(sText);
                oVM.setProperty("/ai/html", sHtml);
                oVM.setProperty("/ai/busy", false);
                this._aiCache[b + "_" + y] = sHtml;
              }.bind(this),
              error: function (oError) {
                oVM.setProperty("/ai/busy", false);
                oVM.setProperty("/ai/visible", false);
                console.error("AI 리포트 에러:", oError);
                MessageToast.show("AI 리포트 생성 중 오류가 발생했습니다.");
              }.bind(this),
            });
        },

        onAiToggle: function () {
          var oVM = this.getView().getModel("view");
          oVM.setProperty("/ai/collapsed", !oVM.getProperty("/ai/collapsed"));
        },

        onAiPrint: function () {
          var oVM = this.getView().getModel("view");
          var sHtml = oVM.getProperty("/ai/html") || "";
          if (!sHtml) {
            MessageToast.show("출력할 AI 요약 내용이 없습니다.");
            return;
          }

          var sBukrs = oVM.getProperty("/bukrs") || "";
          var sYear = oVM.getProperty("/gjahr") || "";
          var sPrevYear = oVM.getProperty("/prevYear") || "";
          var sToday = new Date().toLocaleDateString("ko-KR", {
            year: "numeric",
            month: "long",
            day: "numeric",
          });

          var sCSS =
            'body{font-family:"Malgun Gothic","Apple SD Gothic Neo",Arial,sans-serif;' +
            "font-size:11px;margin:28px 36px;color:#1a1a1a;line-height:1.7}" +
            "h2{text-align:center;font-size:16px;font-weight:700;margin-bottom:4px;color:#1b4f8a}" +
            ".sub{text-align:center;font-size:10px;color:#666;margin-bottom:22px;border-bottom:1px solid #ddd;padding-bottom:12px}" +
            "p{margin:0.25rem 0}" +
            ".footer{text-align:right;font-size:9px;color:#aaa;margin-top:20px;border-top:1px solid #eee;padding-top:8px}" +
            "@media print{@page{size:A4 portrait;margin:15mm 12mm}body{margin:0}}";

          var sDoc =
            '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">' +
            "<title>AI_재무분석_" +
            sBukrs +
            "_" +
            sYear +
            "</title>" +
            "<style>" +
            sCSS +
            "</style></head><body>" +
            "<h2>AI 재무 분석 리포트</h2>" +
            '<div class="sub">회사코드: ' +
            sBukrs +
            "&nbsp;|&nbsp;당기: " +
            sYear +
            "년&nbsp;|&nbsp;전기: " +
            sPrevYear +
            "년</div>" +
            sHtml +
            '<div class="footer">출력일: ' +
            sToday +
            "</div>" +
            "</body></html>";

          var oWin = window.open("", "_blank", "width=820,height=1060");
          if (!oWin) {
            MessageToast.show(
              "팝업이 차단되었습니다. 팝업 허용 후 다시 시도해주세요.",
            );
            return;
          }
          oWin.document.write(sDoc);
          oWin.document.close();
          oWin.focus();
          setTimeout(function () {
            oWin.print();
          }, 400);
        },

        onApproxToggle: function (oEvent) {
          this.getView()
            .getModel("view")
            .setProperty("/showApprox", oEvent.getParameter("pressed"));
        },

        _buildAiPayload: function (oVM) {
          var oPl = oVM.getProperty("/pl") || {};
          var oCf = oVM.getProperty("/cf") || {};
          var oRatio = oVM.getProperty("/ratio") || {};
          return JSON.stringify({
            company: oVM.getProperty("/bukrs"),
            year: oVM.getProperty("/gjahr"),
            bs: {
              totalAsset: oVM.getProperty("/kpiAsset"),
              totalLiab: oVM.getProperty("/kpiLiab"),
              totalEquity: oVM.getProperty("/kpiEquity"),
              nwc: oVM.getProperty("/kpiNwc"),
              currentRatio: oRatio.currRatioC,
              debtRatio: oRatio.debtRatioC,
              equityRatio: oRatio.eqRatioC,
              quickRatio: oRatio.quickRatioC,
            },
            pl: {
              revenue: oPl.revenueKpi,
              opIncome: oPl.opIncomeKpi,
              netIncome: oPl.netIncomeKpi,
              opMargin: oPl.opMargin,
              prevOpMargin: oPl.opMarginPrev,
            },
            cf: {
              operating: oCf.operatingKpi,
              investing: oCf.investingKpi,
              financing: oCf.financingKpi,
              fcf: oCf.fcfKpi,
            },
          });
        },

        _parseAiText: function (sText) {
          if (!sText) return "<p>리포트 내용이 없습니다.</p>";
          var sHtml = "";
          sText.split(/\r?\n/).forEach(function (sLine) {
            sLine = sLine.trim();
            if (!sLine) return;
            if (/^\d+\.\s+/.test(sLine)) {
              sHtml +=
                '<p style="font-weight:700;color:#1b4f8a;margin:0.85rem 0 0.2rem;' +
                'font-size:0.9rem;border-bottom:1px solid #cfe2f5;padding-bottom:3px;">' +
                sLine +
                "</p>";
            } else if (sLine.startsWith("- ")) {
              sHtml +=
                '<p style="margin:0.15rem 0 0.15rem 1.25rem;color:#32363a;font-size:0.875rem;">' +
                "• " +
                sLine.substring(2) +
                "</p>";
            } else {
              sHtml +=
                '<p style="color:#32363a;font-size:0.875rem;">' +
                sLine +
                "</p>";
            }
          });
          return sHtml;
        },

        _processPL: function (aRaw, gjahr, prevYear, oVM) {
          var rev = 0,
            revP = 0;
          var cogs = 0,
            cogsP = 0;
          var sga = 0,
            sgaP = 0;
          var opExp = 0,
            opExpP = 0;
          var nonOpInc = 0,
            nonOpIncP = 0;
          var nonOpExp = 0,
            nonOpExpP = 0;

          aRaw.forEach(function (r) {
            var pfx = (r.Saknr || "").substring(0, 2);
            var c = Math.abs(parseFloat(r.CurrAmt) || 0);
            var p = Math.abs(parseFloat(r.PrevAmt) || 0);
            if (r.MajorClass === "4") {
              if (pfx === "42") {
                nonOpInc += c;
                nonOpIncP += p;
              } else {
                rev += c;
                revP += p;
              }
            } else if (r.MajorClass === "5") {
              if (pfx === "53") {
                nonOpExp += c;
                nonOpExpP += p;
              } else {
                opExp += c;
                opExpP += p;
                if (pfx === "51") {
                  cogs += c;
                  cogsP += p;
                } else if (pfx === "52") {
                  sga += c;
                  sgaP += p;
                }
              }
            }
          });

          var opIncome = rev - opExp;
          var netIncome = opIncome + nonOpInc - nonOpExp;
          var opIncomeP = revP - opExpP;
          var netIncomeP = opIncomeP + nonOpIncP - nonOpExpP;
          var opMargin = rev !== 0 ? (opIncome / rev) * 100 : 0;
          var opMarginP = revP !== 0 ? (opIncomeP / revP) * 100 : 0;
          var cogsRatio = rev !== 0 ? (cogs / rev) * 100 : 0;
          var cogsRatioP = revP !== 0 ? (cogsP / revP) * 100 : 0;

          var waterfallData = [
            { label: "매출액", val: _toOk(rev) },
            { label: "영업비용", val: _toOk(-opExp) },
            { label: "영업이익", val: _toOk(opIncome) },
            { label: "영업외수익", val: _toOk(nonOpInc) },
            { label: "영업외비용", val: _toOk(-nonOpExp) },
            { label: "당기순이익", val: _toOk(netIncome) },
          ];
          var comboData = [
            { label: "매출액", curr: _toOk(rev), prev: _toOk(revP) },
            {
              label: "영업이익",
              curr: _toOk(opIncome),
              prev: _toOk(opIncomeP),
            },
            {
              label: "당기순이익",
              curr: _toOk(netIncome),
              prev: _toOk(netIncomeP),
            },
          ];

          // ── 판관비 세부 구성 (SGA Donut) ────────────────────────
          var mSga = {};
          aRaw.forEach(function (r) {
            if (r.MajorClass !== "5") return;
            var pfx = (r.Saknr || "").substring(0, 2);
            if (pfx !== "52") return;
            var c = Math.abs(parseFloat(r.CurrAmt) || 0);
            if (c <= 0) return;
            var sLabel = (r.Stext || r.Saknr || "기타").trim();
            mSga[sLabel] = (mSga[sLabel] || 0) + c;
          });
          var aSgaSorted = Object.keys(mSga)
            .map(function (k) {
              return { label: k, val: mSga[k] };
            })
            .sort(function (a, b) {
              return b.val - a.val;
            });
          var sgaDonutData = aSgaSorted.slice(0, 8).map(function (it) {
            return {
              label:
                it.label.length > 11 ? it.label.slice(0, 10) + "…" : it.label,
              val: _toOk(it.val),
            };
          });
          var nSgaOther = aSgaSorted.slice(8).reduce(function (s, x) {
            return s + x.val;
          }, 0);
          if (nSgaOther > 0)
            sgaDonutData.push({ label: "기타", val: _toOk(nSgaOther) });

          // ── 비용 구조 분석 (당기 vs 전기 비교) ────────────────
          var otherOpExp = Math.max(0, opExp - cogs - sga);
          var otherOpExpP = Math.max(0, opExpP - cogsP - sgaP);
          var costStructureData = [
            { label: "매출원가", curr: _toOk(cogs), prev: _toOk(cogsP) },
            { label: "판관비", curr: _toOk(sga), prev: _toOk(sgaP) },
            {
              label: "기타영업비용",
              curr: _toOk(otherOpExp),
              prev: _toOk(otherOpExpP),
            },
            {
              label: "영업외비용",
              curr: _toOk(nonOpExp),
              prev: _toOk(nonOpExpP),
            },
          ].filter(function (d) {
            return d.curr > 0 || d.prev > 0;
          });

          oVM.setProperty("/pl", {
            revenue: rev,
            revenueFmt: _fmt(rev),
            revenueKpi: _fmtKpi(rev),
            opIncome: opIncome,
            opIncomeFmt: _fmt(opIncome),
            opIncomeKpi: _fmtKpi(opIncome),
            netIncome: netIncome,
            netIncomeFmt: _fmt(netIncome),
            netIncomeKpi: _fmtKpi(netIncome),
            opMargin: opMargin.toFixed(1) + "%",
            opMarginPrev: opMarginP.toFixed(1) + "%",
            cogsRatio: cogsRatio.toFixed(1) + "%",
            cogsRatioPrev: cogsRatioP.toFixed(1) + "%",
            revDelta: _fmtDelta(rev, revP),
            opDelta: _fmtDelta(opIncome, opIncomeP),
            netDelta: _fmtDelta(netIncome, netIncomeP),
            marginDelta: _fmtDelta(opMargin, opMarginP),
            cogsRatioDelta: _fmtDelta(cogsRatioP, cogsRatio),
            cogsRaw: cogs,
            waterfallData: waterfallData,
            comboData: comboData,
            sgaDonutData: sgaDonutData,
            costStructureData: costStructureData,
          });
          var aPlTree = this._buildPlTree(aRaw);
          this.getView().getModel("tree").setProperty("/plTree", aPlTree);
          oVM.setProperty("/plRows", this._treeToFlatRows(aPlTree));
        },

        _processCF: function (aRaw, gjahr, oVM, aRawPrev) {
          var CF_ADD = [
            "5200000009",
            "5200000014",
            "5300000003",
            "5300000004",
            "5300000005",
            "5300000006",
          ];
          var CF_SUB = ["4200000003", "4200000004", "4200000005"];
          var CASH_KW = ["현금", "보통예금", "당좌예금", "현금성"];

          var netIncome = 0,
            addBack = 0,
            subBack = 0,
            caChg = 0,
            clChg = 0,
            depreciationC = 0;

          aRaw.forEach(function (r) {
            var c = parseFloat(r.CurrAmt) || 0;
            var p = parseFloat(r.PrevAmt) || 0;
            var sak = r.Saknr || "";

            if (r.MajorClass === "4") netIncome += Math.abs(c);
            if (r.MajorClass === "5") netIncome -= Math.abs(c);

            if (CF_ADD.indexOf(sak) >= 0) addBack += Math.abs(c);
            if (sak === "5200000009") depreciationC += Math.abs(c);
            if (CF_SUB.indexOf(sak) >= 0) subBack += Math.abs(c);

            if (r.MinorClass === "11") {
              var isCash = CASH_KW.some(function (kw) {
                return (r.Stext || "").indexOf(kw) >= 0;
              });
              if (!isCash) caChg -= Math.abs(c) - Math.abs(p);
            }
            if (r.MinorClass === "21") {
              clChg += Math.abs(c) - Math.abs(p);
            }
          });

          var operatingCF = netIncome + addBack - subBack + caChg + clChg;
          var investingCF = 0;
          var financingCF = 0;
          var fcf = operatingCF + investingCF;
          var nonCashAdj = addBack - subBack;
          var wcAdj = caChg + clChg;

          var plOpIncome = oVM.getProperty("/pl/opIncome") || 0;
          var plRevenue = oVM.getProperty("/pl/revenue") || 0;
          var ebitda = plOpIncome + depreciationC;
          var ocfMargin = plRevenue !== 0 ? (operatingCF / plRevenue) * 100 : 0;

          var waterfallData = [
            { label: "당기순이익", val: _toOk(netIncome) },
            { label: "비현금비용 가산", val: _toOk(addBack) },
            { label: "비현금수익 차감", val: _toOk(-subBack) },
            { label: "유동자산 변동", val: _toOk(caChg) },
            { label: "유동부채 변동", val: _toOk(clChg) },
            { label: "영업활동 CF", val: _toOk(operatingCF) },
          ];
          var stackedData = [
            {
              label: gjahr + "년",
              netIncome: _toOk(netIncome),
              nonCash: _toOk(nonCashAdj),
              workingCap: _toOk(wcAdj),
            },
          ];

          oVM.setProperty("/cf", {
            operating: operatingCF,
            operatingFmt: _fmt(operatingCF),
            operatingKpi: _fmtKpi(operatingCF),
            investing: investingCF,
            investingFmt: _fmt(investingCF),
            investingKpi: _fmtKpi(investingCF),
            financing: financingCF,
            financingFmt: _fmt(financingCF),
            financingKpi: _fmtKpi(financingCF),
            fcf: fcf,
            fcfFmt: _fmt(fcf),
            fcfKpi: _fmtKpi(fcf),
            ebitda: ebitda,
            ebitdaFmt: _fmt(ebitda),
            ebitdaKpi: _fmtKpi(ebitda),
            ocfMargin: ocfMargin,
            ocfMarginFmt: ocfMargin.toFixed(1) + "%",
            waterfallData: waterfallData,
            stackedData: stackedData,
          });
          var aCfTree = this._buildCfTree(aRaw, aRawPrev || []);
          this.getView().getModel("tree").setProperty("/cfTree", aCfTree);
          oVM.setProperty("/cfRows", this._treeToFlatRows(aCfTree));
        },

        _buildPlTree: function (aRaw) {
          var fmt = function (n) {
            if (n === undefined || n === null) return "—";
            var abs = Math.round(Math.abs(n)).toLocaleString("ko-KR");
            return n < 0 ? "(" + abs + ")" : abs;
          };
          var fmtK = function (n) {
            if (n === undefined || n === null || n === 0) return "—";
            return (
              (n < 0 ? "(" : "") + _fmtKpi(Math.abs(n)) + (n < 0 ? ")" : "")
            );
          };
          var leaf = function (r, amt, amtP) {
            return {
              label: r.Stext || r.Saknr,
              currAmt: amt,
              prevAmt: amtP,
              currFmt: fmt(amt),
              prevFmt: fmt(amtP),
              currKpi: fmtK(amt),
              prevKpi: fmtK(amtP),
              isGroup: false,
              isCalc: false,
              children: [],
            };
          };
          var head = function (label, c, p, isCalc, ch) {
            return {
              label: label,
              currAmt: c,
              prevAmt: p,
              currFmt: fmt(c),
              prevFmt: fmt(p),
              currKpi: fmtK(c),
              prevKpi: fmtK(p),
              isGroup: true,
              isCalc: !!isCalc,
              children: ch || [],
            };
          };

          var rev = [],
            cogs = [],
            sga = [],
            nonOpInc = [],
            nonOpExp = [];
          aRaw.forEach(function (r) {
            if (r.MajorClass !== "4" && r.MajorClass !== "5") return;
            var pfx = (r.Saknr || "").substring(0, 2);
            var c = Math.abs(parseFloat(r.CurrAmt) || 0);
            var p = Math.abs(parseFloat(r.PrevAmt) || 0);
            if (pfx === "41") rev.push(leaf(r, c, p));
            else if (pfx === "51") cogs.push(leaf(r, c, p));
            else if (pfx === "52") sga.push(leaf(r, c, p));
            else if (pfx === "42") nonOpInc.push(leaf(r, c, p));
            else if (pfx === "53") nonOpExp.push(leaf(r, c, p));
          });

          var sum = function (arr, k) {
            return arr.reduce(function (s, x) {
              return s + x[k];
            }, 0);
          };
          var revC = sum(rev, "currAmt"),
            revP = sum(rev, "prevAmt");
          var cogsC = sum(cogs, "currAmt"),
            cogsP = sum(cogs, "prevAmt");
          var sgaC = sum(sga, "currAmt"),
            sgaP = sum(sga, "prevAmt");
          var nOiC = sum(nonOpInc, "currAmt"),
            nOiP = sum(nonOpInc, "prevAmt");
          var nOeC = sum(nonOpExp, "currAmt"),
            nOeP = sum(nonOpExp, "prevAmt");
          var grossC = revC - cogsC,
            grossP = revP - cogsP;
          var opIncC = grossC - sgaC,
            opIncP = grossP - sgaP;
          var netC = opIncC + nOiC - nOeC,
            netP = opIncP + nOiP - nOeP;

          return [
            head("Ⅰ. 매출액", revC, revP, false, rev),
            head("Ⅱ. 매출원가", cogsC, cogsP, false, cogs),
            head("Ⅲ. 매출총이익", grossC, grossP, true, []),
            head("Ⅳ. 판매비와관리비", sgaC, sgaP, false, sga),
            head("Ⅴ. 영업이익", opIncC, opIncP, true, []),
            head("Ⅵ. 영업외수익", nOiC, nOiP, false, nonOpInc),
            head("Ⅶ. 영업외비용", nOeC, nOeP, false, nonOpExp),
            head("Ⅷ. 당기순이익 (손실)", netC, netP, true, []),
          ];
        },

        _buildCfTree: function (aRaw, aRawPrev) {
          var CF_ADD_MAP = {
            5200000009: "감가상각비",
            5200000014: "대손상각비",
            5300000003: "외화환산손실",
            5300000004: "폐기손실",
            5300000005: "처분손실",
            5300000006: "폐기손실 (기타)",
          };
          var CF_SUB_MAP = {
            4200000003: "외화환산이익",
            4200000004: "처분이익",
            4200000005: "대손충당금환입",
          };
          var CASH_KW = ["현금", "보통예금", "당좌예금", "현금성"];

          var fmt = function (n) {
            if (n === undefined || n === null) return "—";
            var abs = Math.round(Math.abs(n)).toLocaleString("ko-KR");
            return n < 0 ? "(" + abs + ")" : abs;
          };
          var fmtK = function (n) {
            if (n === undefined || n === null || n === 0) return "—";
            return (
              (n < 0 ? "(" : "") + _fmtKpi(Math.abs(n)) + (n < 0 ? ")" : "")
            );
          };
          var head = function (label, c, p, isCalc, ch) {
            return {
              label: label,
              currAmt: c,
              prevAmt: p,
              currFmt: fmt(c),
              prevFmt: fmt(p),
              currKpi: fmtK(c),
              prevKpi: fmtK(p),
              isGroup: true,
              isCalc: !!isCalc,
              children: ch || [],
            };
          };
          var leaf = function (label, c, p) {
            return {
              label: label,
              currAmt: c,
              prevAmt: p,
              currFmt: fmt(c),
              prevFmt: fmt(p),
              currKpi: fmtK(c),
              prevKpi: fmtK(p),
              isGroup: false,
              isCalc: false,
              children: [],
            };
          };

          // aRawPrev: N-2년도 데이터 (CurrAmt = N-2 잔액). 전기 운전자본 delta 계산용
          var prevMap = {}; // Saknr → N-2 잔액 (계정이 없으면 key 자체가 없음)
          (aRawPrev || []).forEach(function (r) {
            if (r.Saknr) prevMap[r.Saknr] = parseFloat(r.CurrAmt) || 0;
          });

          var netC = 0,
            netP = 0;
          var addBucket = {},
            subBucket = {};
          var caItems = [],
            clItems = [];

          aRaw.forEach(function (r) {
            var c = parseFloat(r.CurrAmt) || 0;
            var p = parseFloat(r.PrevAmt) || 0;
            var pp = prevMap[r.Saknr] || 0; // N-2 잔액
            var sak = r.Saknr || "";

            if (r.MajorClass === "4") {
              netC += Math.abs(c);
              netP += Math.abs(p);
            }
            if (r.MajorClass === "5") {
              netC -= Math.abs(c);
              netP -= Math.abs(p);
            }

            if (CF_ADD_MAP[sak]) {
              if (!addBucket[sak])
                addBucket[sak] = { label: CF_ADD_MAP[sak], c: 0, p: 0 };
              addBucket[sak].c += Math.abs(c);
              addBucket[sak].p += Math.abs(p);
            }
            if (CF_SUB_MAP[sak]) {
              if (!subBucket[sak])
                subBucket[sak] = { label: CF_SUB_MAP[sak], c: 0, p: 0 };
              subBucket[sak].c += Math.abs(c);
              subBucket[sak].p += Math.abs(p);
            }
            if (r.MinorClass === "11") {
              var isCash = CASH_KW.some(function (kw) {
                return (r.Stext || "").indexOf(kw) >= 0;
              });
              if (!isCash) {
                var delta = -(Math.abs(c) - Math.abs(p));
                var deltaP = sak in prevMap ? -(Math.abs(p) - pp) : 0;
                if (delta !== 0 || deltaP !== 0)
                  caItems.push(
                    leaf((r.Stext || sak) + "의 감소(증가)", delta, deltaP),
                  );
              }
            }
            if (r.MinorClass === "21") {
              var deltaL = Math.abs(c) - Math.abs(p);
              var deltaLP = sak in prevMap ? Math.abs(p) - pp : 0;
              if (deltaL !== 0 || deltaLP !== 0)
                clItems.push(
                  leaf((r.Stext || sak) + "의 증가(감소)", deltaL, deltaLP),
                );
            }
          });

          var addList = Object.keys(addBucket).map(function (k) {
            return leaf(addBucket[k].label, addBucket[k].c, addBucket[k].p);
          });
          var subList = Object.keys(subBucket).map(function (k) {
            return leaf(subBucket[k].label, subBucket[k].c, subBucket[k].p);
          });
          var sum = function (arr) {
            return arr.reduce(function (s, x) {
              return s + x.currAmt;
            }, 0);
          };
          var sumP = function (arr) {
            return arr.reduce(function (s, x) {
              return s + (x.prevAmt || 0);
            }, 0);
          };

          var addTotC = sum(addList),
            addTotP = sumP(addList);
          var subTotC = sum(subList),
            subTotP = sumP(subList);
          var wcTotC = sum(caItems) + sum(clItems);
          var wcTotP = sumP(caItems) + sumP(clItems);
          var operatingCF = netC + addTotC - subTotC + wcTotC;
          var operatingCFP = netP + addTotP - subTotP + wcTotP;

          return [
            head(
              "Ⅰ. 영업활동으로 인한 현금흐름",
              operatingCF,
              operatingCFP,
              true,
              [
                head("1. 당기순이익", netC, netP, false, []),
                head(
                  "2. 현금유출이 없는 비용 가산",
                  addTotC,
                  addTotP,
                  false,
                  addList,
                ),
                head(
                  "3. 현금유입이 없는 수익 차감",
                  -subTotC,
                  -subTotP,
                  false,
                  subList,
                ),
                head(
                  "4. 영업 자산·부채의 변동",
                  wcTotC,
                  wcTotP,
                  false,
                  caItems.concat(clItems),
                ),
              ],
            ),
            head("Ⅱ. 투자활동으로 인한 현금흐름", 0, 0, false, []),
            head("Ⅲ. 재무활동으로 인한 현금흐름", 0, 0, false, []),
            head("Ⅳ. 현금의 증감", operatingCF, operatingCFP, true, []),
          ];
        },

        _applyPlVizProps: function (gjahr, prevYear) {
          var oWf = this.getView().byId("idPlWaterfall");
          if (oWf) {
            oWf.setVizProperties({
              title: { visible: false },
              plotArea: {
                colorPalette: [
                  "#1565c0",
                  "#c62828",
                  "#2e7d32",
                  "#1565c0",
                  "#c62828",
                  "#7b1fa2",
                ],
                drawingEffect: "glossy",
                dataLabel: {
                  visible: true,
                  formatString: "#,##0.0",
                  style: { fontSize: "11px", fontWeight: "bold" },
                },
                dataPoint: { total: ["영업이익", "당기순이익"] },
              },
              valueAxis: {
                title: { visible: true, text: "억원" },
                label: {
                  formatString: "#,##0.0",
                  style: { fontWeight: "bold" },
                },
              },
              categoryAxis: { title: { visible: false } },
              legend: { visible: false },
              tooltip: {
                visible: true,
                bodyMeasureValue: { visible: true, formatString: "#,##0.0" },
              },
            });
          }
          // ── YoY 비교 Column Chart ─────────────────────────────
          var oCombo = this.getView().byId("idPlComboChart");
          if (oCombo) {
            oCombo.setVizProperties({
              title: { visible: false },
              plotArea: {
                colorPalette: ["#1565c0", "#7db9e8"],
                drawingEffect: "glossy",
                dataLabel: {
                  visible: true,
                  formatString: "#,##0.0",
                  style: { fontSize: "11px", fontWeight: "bold" },
                },
                gap: { barSpacing: 0.3 },
              },
              legend: {
                title: { visible: false },
                position: "bottom",
                label: {
                  text: [gjahr + "년 (당기)", prevYear + "년 (전기)"],
                  style: { fontSize: "12px", fontWeight: "bold" },
                },
              },
              valueAxis: {
                title: { visible: true, text: "억원" },
                label: {
                  formatString: "#,##0.0",
                  style: { fontWeight: "bold" },
                },
              },
              categoryAxis: { title: { visible: false } },
              tooltip: {
                visible: true,
                bodyMeasureValue: { visible: true, formatString: "#,##0.0" },
              },
            });
          }

          // ── 판관비 도넛 ────────────────────────────────────────
          var oSga = this.getView().byId("idPlSgaDonut");
          if (oSga) {
            oSga.setVizProperties({
              title: { visible: false },
              legend: {
                visible: true,
                position: "right",
                label: { style: { fontSize: "11px", fontWeight: "bold" } },
              },
              plotArea: {
                colorPalette: [
                  "#1565c0",
                  "#c62828",
                  "#2e7d32",
                  "#7b1fa2",
                  "#e65100",
                  "#0277bd",
                  "#00838f",
                  "#f57f17",
                  "#37474f",
                ],
                drawingEffect: "glossy",
                dataLabel: {
                  visible: true,
                  type: "percentage",
                  hideWhenOverlap: true,
                  style: { fontSize: "10px", fontWeight: "bold" },
                },
              },
              tooltip: {
                visible: true,
                bodyMeasureValue: { visible: true, formatString: "#,##0.0" },
              },
            });
          }

          // ── 비용 구조 분석 (당기 vs 전기) ────────────────────
          var oCostChart = this.getView().byId("idPlMonthlyChart");
          if (oCostChart) {
            oCostChart.setVizProperties({
              title: { visible: false },
              plotArea: {
                colorPalette: ["#1565c0", "#7db9e8"],
                drawingEffect: "glossy",
                dataLabel: {
                  visible: true,
                  formatString: "#,##0.0",
                  style: { fontSize: "10px", fontWeight: "bold" },
                },
              },
              legend: {
                title: { visible: false },
                position: "bottom",
                label: {
                  text: [gjahr + "년 (당기)", prevYear + "년 (전기)"],
                  style: { fontSize: "11px", fontWeight: "bold" },
                },
              },
              valueAxis: {
                title: { visible: true, text: "억원" },
                label: {
                  formatString: "#,##0.0",
                  style: { fontWeight: "bold" },
                },
              },
              categoryAxis: { title: { visible: false } },
              tooltip: {
                visible: true,
                bodyMeasureValue: { visible: true, formatString: "#,##0.0" },
              },
            });
          }
        },

        _applyCfVizProps: function (gjahr) {
          var oWf = this.getView().byId("idCfWaterfall");
          if (oWf) {
            oWf.setVizProperties({
              title: { visible: false },
              plotArea: {
                drawingEffect: "glossy",
                dataLabel: {
                  visible: true,
                  formatString: "#,##0.0",
                  style: { fontSize: "11px", fontWeight: "bold" },
                },
                dataPoint: { total: ["영업활동 CF"] },
              },
              valueAxis: {
                title: { visible: true, text: "억원" },
                label: {
                  formatString: "#,##0.0",
                  style: { fontWeight: "bold" },
                },
              },
              categoryAxis: { title: { visible: false } },
              legend: { visible: false },
              tooltip: {
                visible: true,
                bodyMeasureValue: { visible: true, formatString: "#,##0.0" },
              },
            });
          }
          var oStk = this.getView().byId("idCfStackedChart");
          if (oStk) {
            oStk.setVizProperties({
              title: { visible: false },
              plotArea: {
                colorPalette: ["#1565c0", "#2e7d32", "#e65100"],
                drawingEffect: "glossy",
                dataLabel: {
                  visible: true,
                  formatString: "#,##0.0",
                  style: { fontSize: "11px", fontWeight: "bold" },
                },
              },
              legend: {
                title: { visible: false },
                position: "bottom",
                label: { style: { fontSize: "12px", fontWeight: "bold" } },
              },
              valueAxis: {
                title: { visible: true, text: "억원" },
                label: {
                  formatString: "#,##0.0",
                  style: { fontWeight: "bold" },
                },
              },
              categoryAxis: { title: { visible: false } },
              tooltip: {
                visible: true,
                bodyMeasureValue: { visible: true, formatString: "#,##0.0" },
              },
            });
          }
        },

        _flattenTree: function (aNodes, iDepth) {
          var aRows = [];
          (aNodes || []).forEach(
            function (n) {
              var sIndent = new Array(iDepth * 3 + 1).join(" ");
              aRows.push({
                label: sIndent + n.label,
                currFmt: n.currFmt,
                prevFmt: n.prevFmt,
              });
              if (n.children && n.children.length) {
                Array.prototype.push.apply(
                  aRows,
                  this._flattenTree(n.children, iDepth + 1),
                );
              }
            }.bind(this),
          );
          return aRows;
        },

        onExport: function () {
          var oVM = this.getView().getModel("view");
          var sTab = oVM.getProperty("/activeTab");
          var sYear = oVM.getProperty("/gjahr");
          var sBukrs = oVM.getProperty("/bukrs");
          var sPrevYear = String(parseInt(sYear, 10) - 1);

          var aExportRows, sFileName, sTitleKo;

          if (sTab === "pl") {
            sTitleKo = "손익계산서";
            sFileName = "손익계산서_" + sBukrs + "_" + sYear + ".xlsx";
            aExportRows = this._flattenTree(
              this.getView().getModel("tree").getProperty("/plTree"),
              0,
            );
          } else if (sTab === "cf") {
            sTitleKo = "현금흐름표";
            sFileName = "현금흐름표_" + sBukrs + "_" + sYear + ".xlsx";
            aExportRows = this._flattenTree(
              this.getView().getModel("tree").getProperty("/cfTree"),
              0,
            );
          } else {
            sTitleKo = "재무상태표";
            sFileName = "재무상태표_" + sBukrs + "_" + sYear + ".xlsx";
            aExportRows = (oVM.getProperty("/rows") || []).map(function (r) {
              var sLabel = r.label;
              if (r.level === "group") sLabel = "   " + r.label;
              if (r.level === "item") sLabel = "         " + r.label;
              if (r.level === "total") sLabel = "   " + r.label;
              return { label: sLabel, prevFmt: r.prevFmt, currFmt: r.currFmt };
            });
          }

          sap.ui.require(["sap/ui/export/Spreadsheet"], function (Spreadsheet) {
            new Spreadsheet({
              workbook: {
                columns: [
                  { label: "계정과목", property: "label", width: 40 },
                  {
                    label: "전기 (" + sPrevYear + "년)",
                    property: "prevFmt",
                    width: 22,
                    hAlign: "End",
                  },
                  {
                    label: "당기 (" + sYear + "년)",
                    property: "currFmt",
                    width: 22,
                    hAlign: "End",
                  },
                ],
              },
              dataSource: aExportRows,
              fileName: sFileName,
            })
              .build()
              .then(function () {})
              .catch(function (e) {
                MessageBox.error("저장 실패: " + (e.message || ""));
              });
          });
        },

        onExportPdf: function () {
          var oVM = this.getView().getModel("view");
          var sTab = oVM.getProperty("/activeTab");
          var sYear = oVM.getProperty("/gjahr");
          var sBukrs = oVM.getProperty("/bukrs");
          var sPrevYear = String(parseInt(sYear, 10) - 1);
          var sToday = new Date().toLocaleDateString("ko-KR", {
            year: "numeric",
            month: "long",
            day: "numeric",
          });

          var CSS_COMMON =
            'body{font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;font-size:10.5px;margin:24px 32px;color:#1a1a1a}' +
            "h2{text-align:center;font-size:15px;font-weight:700;margin-bottom:3px}" +
            ".sub{text-align:center;font-size:10px;color:#666;margin-bottom:20px}" +
            "table{width:100%;border-collapse:collapse;table-layout:fixed}" +
            "col.c0{width:52%} col.c1{width:24%} col.c2{width:24%}" +
            "thead th{background:#1b4f8a;color:#fff;padding:7px 10px;font-size:10.5px;font-weight:600}" +
            "thead th:first-child{text-align:left} thead th:not(:first-child){text-align:right}" +
            "td{padding:4px 10px;border-bottom:1px solid #e8e8e8}" +
            "td.num{text-align:right}" +
            ".footer{text-align:right;font-size:9px;color:#aaa;margin-top:10px}" +
            "@media print{@page{size:A4 portrait;margin:15mm 12mm}}";

          var sHtml =
            '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>';
          var sBody = "";

          if (sTab === "pl" || sTab === "cf") {
            var bPl = sTab === "pl";
            var sTit = bPl ? "손 익 계 산 서" : "현 금 흐 름 표 (간접법)";
            var aTree = this.getView()
              .getModel("tree")
              .getProperty(bPl ? "/plTree" : "/cfTree");

            var CSS_TREE =
              "tr.grp td{background:#dce8f5;font-weight:700}" +
              "tr.calc td{background:#b8d4ed;font-weight:700;border-top:2px solid #1b4f8a}" +
              "tr.leaf td:first-child{padding-left:28px}";

            sHtml +=
              (bPl ? "손익계산서_" : "현금흐름표_") +
              sBukrs +
              "_" +
              sYear +
              "</title><style>" +
              CSS_COMMON +
              CSS_TREE +
              "</style></head><body>";
            sHtml += "<h2>" + sTit + "</h2>";
            sHtml +=
              '<div class="sub">회사코드: ' +
              sBukrs +
              "&nbsp;|&nbsp;기간: " +
              sYear +
              "년&nbsp;|&nbsp;전기: " +
              sPrevYear +
              "년</div>";
            sHtml +=
              '<table><colgroup><col class="c0"><col class="c1"><col class="c2"></colgroup>' +
              "<thead><tr><th>과목</th><th>전기 (" +
              sPrevYear +
              "년)</th><th>당기 (" +
              sYear +
              "년)</th></tr></thead><tbody>";

            var renderTree = function (nodes, isChild) {
              (nodes || []).forEach(function (n) {
                var sCls = n.isCalc ? "calc" : n.isGroup ? "grp" : "leaf";
                sHtml +=
                  '<tr class="' +
                  sCls +
                  '"><td>' +
                  n.label +
                  '</td><td class="num">' +
                  (n.prevFmt || "—") +
                  '</td><td class="num">' +
                  (n.currFmt || "—") +
                  "</td></tr>";
                if (n.children && n.children.length)
                  renderTree(n.children, true);
              });
            };
            renderTree(aTree, false);
            sHtml += "</tbody></table>";
          } else {
            var aRows = oVM.getProperty("/rows") || [];
            var CSS_BS =
              "tr.section td{background:#1b4f8a;color:#fff;font-weight:700;padding:5px 10px}" +
              "tr.group   td{background:#dce8f5;font-weight:700}" +
              "tr.group   td:first-child{padding-left:18px}" +
              "tr.item    td:first-child{padding-left:32px}" +
              "tr.total   td{background:#b8d4ed;font-weight:700;border-top:2px solid #1b4f8a}" +
              "tr.grand   td{background:#1b4f8a;color:#fff;font-weight:700;border-top:3px solid #0d3366;padding:6px 10px}";

            sHtml +=
              "재무상태표_" +
              sBukrs +
              "_" +
              sYear +
              "</title><style>" +
              CSS_COMMON +
              CSS_BS +
              "</style></head><body>";
            sHtml += "<h2>재 무 상 태 표</h2>";
            sHtml +=
              '<div class="sub">회사코드: ' +
              sBukrs +
              "&nbsp;|&nbsp;기준일: " +
              sYear +
              "년 12월 31일&nbsp;|&nbsp;비교: " +
              sPrevYear +
              "년 12월 31일</div>";
            sHtml +=
              '<table><colgroup><col class="c0"><col class="c1"><col class="c2"></colgroup>' +
              "<thead><tr><th>계정과목</th><th>전기 (" +
              sPrevYear +
              "년)</th><th>당기 (" +
              sYear +
              "년)</th></tr></thead><tbody>";

            aRows.forEach(function (r) {
              sHtml +=
                '<tr class="' +
                r.level +
                '"><td>' +
                r.label +
                '</td><td class="num">' +
                (r.prevFmt || "") +
                '</td><td class="num">' +
                (r.currFmt || "") +
                "</td></tr>";
            });
            sHtml += "</tbody></table>";
          }

          sHtml +=
            '<div class="footer">출력일: ' + sToday + "</div></body></html>";

          var oWin = window.open(
            "",
            "_blank",
            "width=800,height=900,scrollbars=yes,resizable=yes",
          );
          if (!oWin) {
            MessageBox.warning(
              "팝업이 차단되었습니다. 브라우저에서 팝업 허용 후 다시 시도하세요.",
            );
            return;
          }
          oWin.document.write(sHtml);
          oWin.document.close();
          oWin.focus();
          setTimeout(function () {
            oWin.print();
          }, 400);
        },
      },
    );
  },
);
