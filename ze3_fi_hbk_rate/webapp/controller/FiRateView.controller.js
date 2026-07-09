sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
  ],
  (Controller, JSONModel, Filter, FilterOperator, MessageToast, MessageBox) => {
    "use strict";

    // ── 포맷 유틸 ──────────────────────────────────────────────
    function _fmt(n) {
      return Math.abs(parseFloat(n) || 0).toLocaleString("ko-KR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
    function _fmtKrw(n) {
      return Math.round(Math.abs(parseFloat(n) || 0)).toLocaleString("ko-KR");
    }
    function _fmtDate(d) {
      if (!d) return "";
      if (typeof d === "string") {
        var m = d.match(/\/Date\((\d+)\)\//);
        if (m) d = new Date(parseInt(m[1], 10));
        else return d;
      }
      if (!(d instanceof Date)) return String(d);
      return (
        d.getUTCFullYear() +
        "-" +
        ("0" + (d.getUTCMonth() + 1)).slice(-2) +
        "-" +
        ("0" + d.getUTCDate()).slice(-2)
      );
    }

    var _ORDER = ["KRW", "USD", "EUR", "JPY"];
    function _cmpCurrency(a, b) {
      var ia = _ORDER.indexOf(a.Fwaer), ib = _ORDER.indexOf(b.Fwaer);
      if (ia < 0) ia = 99;
      if (ib < 0) ib = 99;
      return ia !== ib ? ia - ib : b._totalEval - a._totalEval;
    }

    // 오늘 기준 경과일 계산
    function _daysAgo(budat) {
      if (!budat) return 0;
      var ms;
      if (typeof budat === "string") {
        var m = budat.match(/\/Date\((\d+)\)\//);
        ms = m ? parseInt(m[1], 10) : 0;
      } else if (budat instanceof Date) {
        ms = budat.getTime();
      } else {
        ms = 0;
      }
      if (!ms) return 0;
      return Math.floor((Date.now() - ms) / 86400000);
    }

    // ──────────────────────────────────────────────────────────

    return Controller.extend(
      "ze3.fi.hbk.rate.ze3fihbkrate.controller.FiRateView",
      {
        onInit: function () {
          var oToday = new Date();
          var sToday =
            oToday.getFullYear() +
            ("0" + (oToday.getMonth() + 1)).slice(-2) +
            ("0" + oToday.getDate()).slice(-2);

          this.getView().setModel(
            new JSONModel({
              busy: false,
              hasData: false,
              summaryText: "",
              summaryType: "Information",
              totalKrwFmt: "0",
              currencyCards: [],
              items: [],
              hasRateNotice: false,
              rateNotice: "",
              activeTab: "eval",
              // 월간 변동
              monthChange: {
                visible: false,
                prevDateFmt: "",
                currDateFmt: "",
                prevMonthFmt: "",
                currMonthFmt: "",
                changeFmt: "",
                changePct: "",
                isPositive: true,
                items: [],
              },
              // 미결 전표
              openItems: [],
              openItemsFiltered: [],
              openItemsPage: [],
              openItemsCount: "",
              openItemsKpiCards: [],
              oldestInvoice: { visible: false, Belnr: "", BudatFmt: "", DaysOutstanding: 0, Kunnr: "" },
              currentRates: {},
              rateChips: [],
              selectedFwaer: null,
              allBtnType: "Emphasized",
              partnerFilter: "",
              partnerList: [],
              belnrFilter: "",
              blartTypeFilter: "ALL",
              openItemsFilteredSummary: "",
              page: 1,
              pageCount: 1,
              hasOpenItems: false,
              fxGainLossItems: [],
              hasFxGainLoss: false,
            }),
            "view",
          );

          this.byId("idEvdat").setValue(sToday);
          this.byId("idEvdat").setMaxDate(new Date());
        },

        onAfterRendering: function () {
          if (this._bInitialSearchDone) return;
          this._bInitialSearchDone = true;
          this.getOwnerComponent()
            .getModel()
            .metadataLoaded()
            .then(function () { this.onSearch(); }.bind(this));
          this._injectTabIconStyle();
        },

        _injectTabIconStyle: function () {
          if (document.getElementById("fxTabIconOverride")) return;
          setTimeout(function () {
            if (document.getElementById("fxTabIconOverride")) return;
            var el = document.createElement("style");
            el.id = "fxTabIconOverride";
            el.textContent =
              ".sapMITBIconImg{" +
                "background:#0070d2!important;" +
                "background-color:#0070d2!important;" +
                "border:none!important;" +
                "box-shadow:none!important;" +
              "}" +
              ".sapMITBIconImg .sapUiIcon{color:#ffffff!important;}" +
              ".sapMITBIconImgSel{" +
                "background:#005ab4!important;" +
                "background-color:#005ab4!important;" +
                "border:none!important;" +
                "box-shadow:none!important;" +
              "}" +
              ".sapMITBIconImgSel .sapUiIcon{color:#ffffff!important;}" +
              ".sapMITBSelected .sapMITBIconImg{" +
                "background:#0854a0!important;" +
                "background-color:#0854a0!important;" +
                "border:none!important;" +
                "box-shadow:0 0 0 3px rgba(0,112,210,0.25)!important;" +
              "}" +
              ".sapMITBSelected .sapMITBIconImg .sapUiIcon{color:#ffffff!important;}";
            document.head.appendChild(el);
          }, 400);
        },

        // ── 조회 ─────────────────────────────────────────────────
        onSearch: function () {
          var sEvdat = this.byId("idEvdat").getValue();
          if (!sEvdat) { MessageToast.show("조회 기준일을 선택해주세요."); return; }
          var sClean = sEvdat.replace(/-/g, "");
          if (sClean.length !== 8) { MessageToast.show("올바른 날짜 형식이 아닙니다."); return; }

          var oNow = new Date();
          var sTodayClean = oNow.getFullYear() +
            ("0" + (oNow.getMonth() + 1)).slice(-2) +
            ("0" + oNow.getDate()).slice(-2);
          if (sClean > sTodayClean) {
            MessageToast.show("기준일은 오늘 이후를 선택할 수 없습니다.");
            return;
          }

          var oDate = new Date(Date.UTC(
            parseInt(sClean.slice(0, 4), 10),
            parseInt(sClean.slice(4, 6), 10) - 1,
            parseInt(sClean.slice(6, 8), 10),
          ));
          this._oCurrentQueryDate = oDate;

          var oVM = this.getView().getModel("view");
          oVM.setProperty("/busy", true);
          oVM.setProperty("/hasData", false);
          oVM.setProperty("/hasRateNotice", false);
          oVM.setProperty("/currentRates", {});
          oVM.setProperty("/monthChange/visible", false);
          oVM.setProperty("/oldestInvoice/visible", false);
          oVM.setProperty("/partnerFilter", "");
          oVM.setProperty("/belnrFilter", "");
          oVM.setProperty("/blartTypeFilter", "ALL");
          oVM.setProperty("/hasOpenItems",   false);
          this._pendingRawOpenItems = null;

          this._loadWithFallback(oDate, 0, oVM);
          this._loadOpenItems(oVM);
          this._loadRateHistory(oDate);
        },

        // ── 환율 폴백 조회 ───────────────────────────────────────
        _loadWithFallback: function (oTargetDate, nBack, oVM) {
          if (nBack > 7) {
            oVM.setProperty("/busy", false);
            MessageBox.warning("7일 이내 환율 데이터가 없습니다.\n관리자에게 문의하세요.");
            return;
          }
          var oQueryDate = new Date(Date.UTC(
            oTargetDate.getUTCFullYear(),
            oTargetDate.getUTCMonth(),
            oTargetDate.getUTCDate() - nBack,
          ));
          var oModel = this.getOwnerComponent().getModel();
          var sPath = "/" + oModel.createKey("ZCDS_E3_FI_0012", { P_EVDAT: oQueryDate }) + "/Set";

          oModel.read(sPath, {
            success: function (d) {
              var aResults = d.results || [];
              var aFx = aResults.filter(function (r) { return r.Fwaer !== "KRW"; });
              var bHasRate = aFx.some(function (r) { return Math.abs(parseFloat(r.Ukurs) || 0) > 0; });
              if (aFx.length && !bHasRate) {
                this._loadWithFallback(oTargetDate, nBack + 1, oVM);
                return;
              }
              oVM.setProperty("/busy", false);
              if (!aResults.length) { MessageToast.show("조회된 데이터가 없습니다."); return; }
              if (nBack > 0) {
                var sQ = _fmtDate(oQueryDate);
                oVM.setProperty("/hasRateNotice", true);
                oVM.setProperty("/rateNotice", "기준일 환율 없음 — " + sQ + " 환율 적용 (" + nBack + "일 전)");
              }
              this._process(aResults, oVM);
            }.bind(this),
            error: function (e) {
              oVM.setProperty("/busy", false);
              var sMsg = e.message;
              try { sMsg = JSON.parse(e.responseText).error.message.value; } catch (x) {}
              MessageBox.error("조회 오류: " + sMsg);
            }.bind(this),
          });
        },

        // ── 데이터 가공 ──────────────────────────────────────────
        _process: function (aRaw, oVM) {
          var mSummary = {};
          var fTotal = 0, fFxTotal = 0, fKrwTotal = 0;

          var aItems = aRaw.map(function (r) {
            var bKrw = r.Fwaer === "KRW";
            var bZeroDecFx = !bKrw && r.Fwaer === "JPY";
            var fWrbtr = bKrw ? parseFloat(r.Dmbtr) || 0 : Math.abs(parseFloat(r.Wrbtr) || 0);
            var fUkurs = bKrw ? 1 : Math.abs(parseFloat(r.Ukurs) || 0);
            var fEval = bKrw ? fWrbtr : fWrbtr * fUkurs;
            var fWrbtrDisp = bZeroDecFx ? fWrbtr * 100 : fWrbtr;

            if (!mSummary[r.Fwaer]) {
              mSummary[r.Fwaer] = {
                Fwaer: r.Fwaer, TotalWrbtr: 0, TotalWrbtrRaw: 0,
                Ukurs: fUkurs, TotalEval: 0,
                IsKrw: bKrw, IsZeroDecFx: bZeroDecFx,
              };
            }
            mSummary[r.Fwaer].TotalWrbtr    += fWrbtrDisp;
            mSummary[r.Fwaer].TotalWrbtrRaw += fWrbtr;
            mSummary[r.Fwaer].TotalEval     += fEval;
            fTotal += fEval;
            if (bKrw) fKrwTotal += fEval;
            else       fFxTotal  += fEval;

            return {
              Hbkid: r.Hbkid,
              Hktid: r.Hktid,
              Fwaer: r.Fwaer,
              WrbtrFmt: bKrw || bZeroDecFx ? _fmtKrw(fWrbtrDisp) : _fmt(fWrbtr),
              // JPY: 1엔 단위로 표시
              UkursFmt: bKrw ? "-" : _fmtKrw(fUkurs),
              EvalKrwFmt: _fmtKrw(fEval),
              IsKrw: bKrw,
              _evalKrw: fEval,
            };
          });

          var aSummary = Object.keys(mSummary).map(function (key) {
            var s = mSummary[key];
            return {
              Fwaer: s.Fwaer,
              TotalWrbtrFmt: s.IsKrw || s.IsZeroDecFx ? _fmtKrw(s.TotalWrbtr) : _fmt(s.TotalWrbtr),
              // JPY: 1엔 단위 환율 표시
              UkursFmt: s.IsKrw ? "-" : _fmtKrw(s.Ukurs),
              TotalEvalFmt: _fmtKrw(s.TotalEval),
              IsKrw: s.IsKrw, IsZeroDecFx: s.IsZeroDecFx,
              _totalEval: s.TotalEval,
            };
          }).sort(_cmpCurrency);

          var fxCount = Object.keys(mSummary).filter(function (k) { return k !== "KRW"; }).length;

          var aCurrencyCards = aSummary.map(function (s) {
            var aAccts = aItems.filter(function (item) { return item.Fwaer === s.Fwaer; });
            return {
              title: s.IsKrw ? "KRW 원화 보유" : s.Fwaer + " 외화 보유",
              subtitle: s.IsKrw ? "원화 직접 보유"
                : (s.IsZeroDecFx ? "환율  " + s.UkursFmt + " 원 / 100엔"
                                 : "환율  " + s.UkursFmt + " 원"),
              fwaer: s.Fwaer,
              totalWrbtrFmt: s.TotalWrbtrFmt,
              totalEvalFmt: s.TotalEvalFmt,
              isKrw: s.IsKrw,
              cssClass: "hbkCurrCard hbkCurrCard--" + s.Fwaer.toLowerCase(),
              icon: s.IsKrw ? "sap-icon://home" : "sap-icon://money-bills",
              accounts: aAccts,
            };
          });

          // 합계 KPI 항목을 맨 앞에 추가
          aCurrencyCards.unshift({
            title: "총 KRW 평가금액",
            subtitle: fxCount + "개 외화 통화 보유",
            fwaer: "원",
            totalWrbtrFmt: _fmtKrw(fTotal),
            totalEvalFmt: "",
            isKrw: true,
            cssClass: "hbkKpiTotal",
            icon: "sap-icon://money-bills",
            accounts: [],
          });

          var aChartData = aItems.map(function (item) {
            return { Label: item.Fwaer + " / " + item.Hktid, EvalKrw: item._evalKrw };
          }).sort(function (a, b) { return b.EvalKrw - a.EvalKrw; });
          var sSummary =
            "합계 : " + _fmtKrw(fTotal) + " 원" +
            "   |   외화 평가 : " + _fmtKrw(fFxTotal) + " 원" +
            "   |   원화 보유 : " + _fmtKrw(fKrwTotal) + " 원" +
            "   |   외화 통화 수 : " + fxCount + " 종";

          var mRates = {};
          Object.keys(mSummary).forEach(function (k) {
            if (k !== "KRW") mRates[k] = mSummary[k].Ukurs;
          });

          var aRateChips = _ORDER.filter(function (k) { return k !== "KRW" && mSummary[k]; }).map(function (k) {
            var s = mSummary[k];
            return {
              fwaer: k,
              label: s.IsZeroDecFx ? k + "  " + _fmtKrw(s.Ukurs) + " 원 / 100엔"
                                   : k + "  " + _fmtKrw(s.Ukurs) + " 원",
              rateLabel: s.IsZeroDecFx ? _fmtKrw(s.Ukurs) + " 원 / 100엔"
                                       : _fmtKrw(s.Ukurs) + " 원",
            };
          });

          oVM.setProperty("/currentRates", mRates);
          oVM.setProperty("/rateChips", aRateChips);
          oVM.setProperty("/currencyCards", aCurrencyCards);
          oVM.setProperty("/items", aItems);
          oVM.setProperty("/totalKrwFmt", _fmtKrw(fTotal));
          oVM.setProperty("/summaryText", sSummary);
          oVM.setProperty("/summaryType", "Information");
          this._updateChart(aChartData);
          this._updateCurrDonut(aSummary, fTotal);
          this._updateBankDonut(aItems);
          oVM.setProperty("/hasData", true);

          // 월간 변동 + 환차손익 분리를 위해 저장
          this._fCurrTotal     = fTotal;
          this._mCurrEval      = {};
          this._mCurrWrbtrRaw  = {};
          this._mCurrRate      = {};
          Object.keys(mSummary).forEach(function (k) {
            this._mCurrEval[k]     = mSummary[k].TotalEval;
            this._mCurrWrbtrRaw[k] = mSummary[k].TotalWrbtrRaw;
            this._mCurrRate[k]     = mSummary[k].Ukurs;
          }.bind(this));
          this._loadMonthlyChange(this._oCurrentQueryDate, oVM);

          if (this._pendingRawOpenItems) {
            this._processOpenItems(this._pendingRawOpenItems, oVM);
            this._pendingRawOpenItems = null;
          }
        },

        // ── 차트 ─────────────────────────────────────────────────
        _updateChart: function (aChartData) {
          var oVizFrame = this.byId("idPnlChart");
          if (!oVizFrame) return;
          sap.ui.require(
            ["sap/viz/ui5/data/FlattenedDataset", "sap/viz/ui5/controls/common/feeds/FeedItem"],
            function (FlattenedDataset, FeedItem) {
              oVizFrame.setVizType("bar");
              oVizFrame.setModel(new JSONModel({ data: aChartData }));
              oVizFrame.setDataset(new FlattenedDataset({
                dimensions: [{ name: "계좌 / 통화", value: "{Label}" }],
                measures:   [{ name: "KRW 평가",    value: "{EvalKrw}" }],
                data: { path: "/data" },
              }));
              if (!oVizFrame.getFeeds().length) {
                oVizFrame.addFeed(new FeedItem({ uid: "valueAxis",    type: "Measure",   values: ["KRW 평가"] }));
                oVizFrame.addFeed(new FeedItem({ uid: "categoryAxis", type: "Dimension", values: ["계좌 / 통화"] }));
              }
              oVizFrame.setVizProperties({
                title:  { visible: false },
                legend: { visible: false },
                plotArea: { dataLabel: { visible: false }, colorPalette: ["#1565c0"] },
                valueAxis:    { title: { visible: true, text: "KRW (원)" } },
                categoryAxis: { title: { visible: false } },
              });
            },
          );
        },

        // ── 통화별 비중 도넛 ──────────────────────────────────────
        _updateCurrDonut: function (aSummary, fTotal) {
          var oViz = this.byId("idCurrDonut");
          if (!oViz) return;
          var COLORS = { KRW: "#107e3e", USD: "#0070d2", EUR: "#e76500", JPY: "#c21010" };
          var aData = aSummary.map(function (s) {
            var pct = fTotal > 0 ? (s._totalEval / fTotal * 100) : 0;
            return {
              Currency: s.Fwaer,
              Value:    Math.round(s._totalEval),
              PctLabel: pct.toFixed(1) + "%",
            };
          });
          var aPalette = aSummary.map(function (s) {
            return COLORS[s.Fwaer] || "#8c8c8c";
          });
          sap.ui.require(
            ["sap/viz/ui5/data/FlattenedDataset", "sap/viz/ui5/controls/common/feeds/FeedItem"],
            function (FlattenedDataset, FeedItem) {
              oViz.setVizType("donut");
              oViz.setModel(new JSONModel({ data: aData }));
              oViz.setDataset(new FlattenedDataset({
                dimensions: [{ name: "통화", value: "{Currency}" }],
                measures:   [{ name: "KRW 평가", value: "{Value}" }],
                data: { path: "/data" },
              }));
              oViz.removeAllFeeds();
              oViz.addFeed(new FeedItem({ uid: "size",  type: "Measure",   values: ["KRW 평가"] }));
              oViz.addFeed(new FeedItem({ uid: "color", type: "Dimension", values: ["통화"] }));
              oViz.setVizProperties({
                title:  { visible: false },
                legend: { visible: true, position: "right",
                          label: { style: { fontSize: "11px" } } },
                plotArea: {
                  colorPalette: aPalette,
                  dataLabel: {
                    visible: true,
                    type: "percentage",
                    style: { fontSize: "12px", fontWeight: "bold" },
                  },
                },
              });
            },
          );
        },

        // ── 하우스뱅크별 분포 도넛 ────────────────────────────────
        _updateBankDonut: function (aItems) {
          var oViz = this.byId("idBankDonut");
          if (!oViz) return;
          var mBank = {};
          aItems.forEach(function (item) {
            var key = item.Hbkid || "?";
            mBank[key] = (mBank[key] || 0) + (item._evalKrw || 0);
          });
          var aData = Object.keys(mBank)
            .sort(function (a, b) { return mBank[b] - mBank[a]; })
            .map(function (k) {
              return { Bank: k, Value: Math.round(mBank[k]) };
            });
          var BANK_COLORS = [
            "#0070d2", "#107e3e", "#e76500", "#c21010",
            "#6800d6", "#0f7dc3", "#3da83d", "#c45800",
          ];
          var aPalette = aData.map(function (_, i) {
            return BANK_COLORS[i % BANK_COLORS.length];
          });
          sap.ui.require(
            ["sap/viz/ui5/data/FlattenedDataset", "sap/viz/ui5/controls/common/feeds/FeedItem"],
            function (FlattenedDataset, FeedItem) {
              oViz.setVizType("donut");
              oViz.setModel(new JSONModel({ data: aData }));
              oViz.setDataset(new FlattenedDataset({
                dimensions: [{ name: "하우스뱅크", value: "{Bank}" }],
                measures:   [{ name: "KRW 평가",  value: "{Value}" }],
                data: { path: "/data" },
              }));
              oViz.removeAllFeeds();
              oViz.addFeed(new FeedItem({ uid: "size",  type: "Measure",   values: ["KRW 평가"] }));
              oViz.addFeed(new FeedItem({ uid: "color", type: "Dimension", values: ["하우스뱅크"] }));
              oViz.setVizProperties({
                title:  { visible: false },
                legend: { visible: true, position: "right",
                          label: { style: { fontSize: "11px" } } },
                plotArea: {
                  colorPalette: aPalette,
                  dataLabel: {
                    visible: true,
                    type: "percentage",
                    style: { fontSize: "12px", fontWeight: "bold" },
                  },
                },
              });
            },
          );
        },

        // ── 월간 변동 비교 ────────────────────────────────────────
        _loadMonthlyChange: function (oCurrentDate, oVM) {
          if (!oCurrentDate) return;
          var oPrevDate = new Date(Date.UTC(
            oCurrentDate.getUTCFullYear(),
            oCurrentDate.getUTCMonth() - 1,
            oCurrentDate.getUTCDate(),
          ));
          this._simpleEvalQuery(oPrevDate, 0, function (aRaw) {
            if (!aRaw || !aRaw.length) return;
            this._computeMonthlyChange(aRaw, oCurrentDate, oPrevDate, oVM);
          }.bind(this));
        },

        _simpleEvalQuery: function (oDate, nBack, fnCallback) {
          if (nBack > 7) { fnCallback(null); return; }
          var oQueryDate = new Date(Date.UTC(
            oDate.getUTCFullYear(), oDate.getUTCMonth(), oDate.getUTCDate() - nBack,
          ));
          var oModel = this.getOwnerComponent().getModel();
          var sPath = "/" + oModel.createKey("ZCDS_E3_FI_0012", { P_EVDAT: oQueryDate }) + "/Set";
          oModel.read(sPath, {
            success: function (d) {
              var aRaw = d.results || [];
              var aFx  = aRaw.filter(function (r) { return r.Fwaer !== "KRW"; });
              var bHasRate = aFx.some(function (r) { return Math.abs(parseFloat(r.Ukurs) || 0) > 0; });
              if (aFx.length && !bHasRate) {
                this._simpleEvalQuery(oDate, nBack + 1, fnCallback);
              } else {
                fnCallback(aRaw);
              }
            }.bind(this),
            error: function () { fnCallback(null); },
          });
        },

        _computeMonthlyChange: function (aPrevRaw, oCurrentDate, oPrevDate, oVM) {
          var fPrevTotal = 0, mPrevByFwaer = {}, mPrevWrbtrRaw = {}, mPrevRate = {};
          aPrevRaw.forEach(function (r) {
            var bKrw = r.Fwaer === "KRW";
            var fWrbtr = bKrw ? (parseFloat(r.Dmbtr) || 0) : Math.abs(parseFloat(r.Wrbtr) || 0);
            var fUkurs = bKrw ? 1 : Math.abs(parseFloat(r.Ukurs) || 0);
            var fEval  = bKrw ? fWrbtr : fWrbtr * fUkurs;
            fPrevTotal += fEval;
            mPrevByFwaer[r.Fwaer]  = (mPrevByFwaer[r.Fwaer]  || 0) + fEval;
            mPrevWrbtrRaw[r.Fwaer] = (mPrevWrbtrRaw[r.Fwaer] || 0) + fWrbtr;
            mPrevRate[r.Fwaer]     = fUkurs;
          });

          var fCurrTotal   = this._fCurrTotal || 0;
          var mCurrByFwaer = this._mCurrEval  || {};
          var fDiff    = fCurrTotal - fPrevTotal;
          var fDiffPct = fPrevTotal > 0 ? (fDiff / fPrevTotal * 100) : 0;

          // 통화별 변동
          var aKeys = Object.keys(Object.assign({}, mCurrByFwaer, mPrevByFwaer));
          aKeys.sort(function (a, b) {
            var ia = _ORDER.indexOf(a), ib = _ORDER.indexOf(b);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
          });
          var aItems = aKeys.map(function (fwaer) {
            var curr = mCurrByFwaer[fwaer] || 0;
            var prev = mPrevByFwaer[fwaer] || 0;
            var diff = curr - prev;
            var bPos = diff >= 0;
            return {
              Fwaer:      fwaer,
              CurrFmt:    _fmtKrw(curr) + " 원",
              PrevFmt:    _fmtKrw(prev) + " 원",
              DiffFmt:    (bPos ? "▲ " : "▼ ") + _fmtKrw(Math.abs(diff)) + " 원",
              DiffPct:    (bPos ? "+" : "-") + Math.abs(Math.round(fDiffPct * 10) / 10) + "%",
              DiffState:  bPos ? "Success" : "Error",
              isPos:      bPos,
            };
          });

          var bPos = fDiff >= 0;
          // 월명 포맷 (YYYY년 M월)
          function _monthLabel(dt) {
            return dt.getUTCFullYear() + "년 " + (dt.getUTCMonth() + 1) + "월";
          }

          // ── 환차손익 분리: 환율 효과 vs 잔액 효과 ──────────────
          var mCurrWrbtrRaw = this._mCurrWrbtrRaw || {};
          var mCurrRate     = this._mCurrRate     || {};
          var aFxItems = _ORDER.filter(function (k) {
            return mCurrByFwaer[k] || mPrevByFwaer[k];
          }).map(function (k) {
            if (k === "KRW") {
              var volKrw = (mCurrByFwaer[k] || 0) - (mPrevByFwaer[k] || 0);
              return {
                Fwaer:       k,
                FxEffFmt:    "-",
                VolEffFmt:   (volKrw >= 0 ? "▲ " : "▼ ") + _fmtKrw(Math.abs(volKrw)) + " 원",
                FxEffState:  "None",
                VolEffState: volKrw >= 0 ? "Success" : "Error",
              };
            }
            var prevBal  = mPrevWrbtrRaw[k] || 0;
            var prevRate = mPrevRate[k]      || 0;
            var currBal  = mCurrWrbtrRaw[k]  || 0;
            var currRate = mCurrRate[k]       || 0;
            var fxEff    = prevBal * (currRate - prevRate);
            var volEff   = (currBal - prevBal) * prevRate;
            return {
              Fwaer:       k,
              FxEffFmt:    (fxEff >= 0 ? "▲ " : "▼ ") + _fmtKrw(Math.abs(fxEff)) + " 원",
              VolEffFmt:   (volEff >= 0 ? "▲ " : "▼ ") + _fmtKrw(Math.abs(volEff)) + " 원",
              FxEffState:  fxEff  >= 0 ? "Success" : "Error",
              VolEffState: volEff >= 0 ? "Success" : "Error",
            };
          });

          oVM.setProperty("/monthChange/visible",      true);
          oVM.setProperty("/monthChange/prevDateFmt",  _fmtDate(oPrevDate));
          oVM.setProperty("/monthChange/currDateFmt",  _fmtDate(oCurrentDate));
          oVM.setProperty("/monthChange/prevMonthFmt", _monthLabel(oPrevDate));
          oVM.setProperty("/monthChange/currMonthFmt", _monthLabel(oCurrentDate));
          oVM.setProperty("/monthChange/changeFmt",
            (bPos ? "▲ " : "▼ ") + _fmtKrw(Math.abs(fDiff)) + " 원");
          oVM.setProperty("/monthChange/changePct",
            (bPos ? "+" : "-") + Math.abs(Math.round(fDiffPct * 10) / 10) + "%");
          oVM.setProperty("/monthChange/isPositive",  bPos);
          oVM.setProperty("/monthChange/items",       aItems);
          oVM.setProperty("/fxGainLossItems",         aFxItems);
          oVM.setProperty("/hasFxGainLoss",           aFxItems.length > 0);
        },

        // ── 1주일 환율 이력 조회 ──────────────────────────────────
        _loadRateHistory: function (oBaseDate) {
          var oModel = this.getOwnerComponent().getModel("rateHistoryService");
          if (!oModel) return;
          var oStartDate = new Date(Date.UTC(
            oBaseDate.getUTCFullYear(), oBaseDate.getUTCMonth(), oBaseDate.getUTCDate() - 6,
          ));
          function _d(dt) {
            return dt.getUTCFullYear() + "-" + ("0" + (dt.getUTCMonth() + 1)).slice(-2) + "-" + ("0" + dt.getUTCDate()).slice(-2);
          }
          oModel.read("/ZCDS_E3_FI_0008", {
            urlParameters: {
              $filter: "Erdat ge datetime'" + _d(oStartDate) + "T00:00:00' and Erdat le datetime'" + _d(oBaseDate) + "T00:00:00'",
              $orderby: "Erdat asc,Fcurr asc",
            },
            success: function (d) {
              this._aRateHistRaw = d.results || [];
              var oSeg = this.byId("idRateChartCurr");
              var sCurr = oSeg ? (oSeg.getSelectedKey() || "JPY") : "JPY";
              this._updateRateChart(this._aRateHistRaw, sCurr);
            }.bind(this),
            error: function () {},
          });
        },

        onRateCurrChange: function (oEvent) {
          var oItem  = oEvent.getParameter("item");
          var sCurr  = oItem ? oItem.getKey() : "JPY";
          if (this._aRateHistRaw) this._updateRateChart(this._aRateHistRaw, sCurr);
        },

        // ── 환율 꺾은선 그래프 (JPY: 100엔 단위) ──────────────────
        _updateRateChart: function (aRaw, sCurr) {
          var oVizFrame = this.byId("idRateHistChart");
          if (!oVizFrame) return;

          var mCurrConfig = {
            USD: { name: "USD (원/1달러)",   field: "USD", color: "#1565c0" },
            EUR: { name: "EUR (원/1유로)",   field: "EUR", color: "#e65100" },
            JPY: { name: "JPY (원/100엔)",   field: "JPY", color: "#2e7d32" },
          };
          var oCfg = mCurrConfig[sCurr] || mCurrConfig.USD;

          var mPivot = {}, aDates = [];
          aRaw.forEach(function (r) {
            var sDate = _fmtDate(r.Erdat);
            if (!mPivot[sDate]) { mPivot[sDate] = { Date: sDate }; aDates.push(sDate); }
            var fRate = Math.abs(parseFloat(r.Ukurs) || 0);
            mPivot[sDate][r.Fcurr] = fRate;
          });

          var aData = aDates.map(function (d) { return mPivot[d]; });

          var fMin = Infinity, fMax = -Infinity;
          aData.forEach(function (row) {
            var v = row[oCfg.field];
            if (v != null && !isNaN(v)) { fMin = Math.min(fMin, v); fMax = Math.max(fMax, v); }
          });
          var fBuf     = sCurr === "JPY" ? 50 : 20;
          var fAxisMin = fMin === Infinity  ? 0   : fMin - fBuf;
          var fAxisMax = fMax === -Infinity ? 100 : fMax + fBuf;

          sap.ui.require(
            ["sap/viz/ui5/data/FlattenedDataset", "sap/viz/ui5/controls/common/feeds/FeedItem"],
            function (FlattenedDataset, FeedItem) {
              oVizFrame.setVizType("line");
              oVizFrame.setModel(new JSONModel({ data: aData }));
              oVizFrame.setDataset(new FlattenedDataset({
                dimensions: [{ name: "날짜", value: "{Date}" }],
                measures:   [{ name: oCfg.name, value: "{" + oCfg.field + "}" }],
                data: { path: "/data" },
              }));
              oVizFrame.removeAllFeeds();
              oVizFrame.addFeed(new FeedItem({ uid: "valueAxis",    type: "Measure",   values: [oCfg.name] }));
              oVizFrame.addFeed(new FeedItem({ uid: "categoryAxis", type: "Dimension", values: ["날짜"] }));
              oVizFrame.setVizProperties({
                title:  { visible: false },
                legend: { visible: false },
                plotArea: { dataLabel: { visible: true }, colorPalette: [oCfg.color] },
                valueAxis: {
                  title: { visible: true, text: oCfg.name },
                  scale: { zeroAlwaysVisible: false, fixedRange: true, minValue: fAxisMin, maxValue: fAxisMax },
                },
                categoryAxis: { title: { visible: false } },
              });
            },
          );
        },

        onTabSelect: function (oEvent) {
          this.getView().getModel("view").setProperty("/activeTab", oEvent.getParameter("key"));
        },

        // ── 미결 전표 조회 ────────────────────────────────────────
        _loadOpenItems: function (oVM) {
          var oModel = this.getOwnerComponent().getModel("openItemsService");
          if (!oModel) { MessageBox.error("미결 전표 서비스 모델을 찾을 수 없습니다."); return; }
          oModel.read("/ZCDS_E3_FI_0014", {
            success: function (d) {
              var aResults = d.results || [];
              var mRates = oVM.getProperty("/currentRates") || {};
              if (Object.keys(mRates).length === 0) {
                this._pendingRawOpenItems = aResults;
              } else {
                this._processOpenItems(aResults, oVM);
              }
            }.bind(this),
            error: function (e) {
              var sMsg = "미결 전표 조회 실패";
              try { sMsg += "\n" + JSON.parse(e.responseText).error.message.value; } catch (x) {}
              MessageBox.error(sMsg);
            },
          });
        },

        // ── 페이지네이션 ──────────────────────────────────────────
        _PAGE_SIZE: 15,

        _applyPage: function (oVM) {
          var aAll  = oVM.getProperty("/openItemsFiltered") || [];
          var nPage = oVM.getProperty("/page") || 1;
          var nCnt  = Math.max(1, Math.ceil(aAll.length / this._PAGE_SIZE));
          nPage     = Math.min(nPage, nCnt);
          oVM.setProperty("/pageCount", nCnt);
          oVM.setProperty("/page",      nPage);
          oVM.setProperty("/openItemsPage",
            aAll.slice((nPage - 1) * this._PAGE_SIZE, nPage * this._PAGE_SIZE));
        },

        onPrevPage: function () {
          var oVM = this.getView().getModel("view");
          oVM.setProperty("/page", (oVM.getProperty("/page") || 1) - 1);
          this._applyPage(oVM);
        },
        onNextPage: function () {
          var oVM = this.getView().getModel("view");
          oVM.setProperty("/page", (oVM.getProperty("/page") || 1) + 1);
          this._applyPage(oVM);
        },

        // ── 미결 전표 데이터 가공 ─────────────────────────────────
        _processOpenItems: function (aRaw, oVM) {
          var mRates = oVM.getProperty("/currentRates") || {};
          var mByFwaer = {};
          var oToday = new Date();

          // Shkzg 제한 없이 모든 미결 항목 표시
          // (이전: 고객=S, 공급업체=H 필터 → 공급업체 행 누락 문제)
          var aSrc = aRaw;

          var aItems = aSrc.map(function (r) {
            var sFwaer = r.Fwaer || "KRW";
            var bKrw   = sFwaer === "KRW";
            var bZeroDecFx = !bKrw && sFwaer === "JPY";

            var fWrbtr = Math.abs(parseFloat(r.Wrbtr) || 0);
            var fDmbtr = Math.abs(parseFloat(r.Dmbtr) || 0);
            var fKursf = Math.abs(parseFloat(r.Kursf) || 0);
            var fCurrentUkurs = bKrw ? 1 : (mRates[sFwaer] || 0);

            var fWrbtrRaw = bZeroDecFx ? fWrbtr / 100 : fWrbtr;
            var fEvalAmt  = bKrw ? fDmbtr : fWrbtrRaw * fCurrentUkurs;
            var fEvalPnl  = fEvalAmt - fDmbtr;
            var fWrbtrDisp = bKrw ? fDmbtr : fWrbtr;

            // 경과일
            var nDays = _daysAgo(r.Budat);
            var sOverdueState = nDays > 90 ? "Error" : nDays > 30 ? "Warning" : "None";

            if (!mByFwaer[sFwaer]) {
              mByFwaer[sFwaer] = {
                Fwaer: sFwaer, IsKrw: bKrw, IsZeroDecFx: bZeroDecFx,
                count: 0, TotalWrbtr: 0, TotalDmbtr: 0, TotalEvalAmt: 0, TotalEvalPnl: 0,
              };
            }
            mByFwaer[sFwaer].count++;
            mByFwaer[sFwaer].TotalWrbtr   += fWrbtrDisp;
            mByFwaer[sFwaer].TotalDmbtr   += fDmbtr;
            mByFwaer[sFwaer].TotalEvalAmt += fEvalAmt;
            mByFwaer[sFwaer].TotalEvalPnl += fEvalPnl;

            var sKunnr = (r.Kunnr || "").replace(/^0+/, "");
            var sLifnr = (r.Lifnr || "").replace(/^0+/, "");
            var bPnlPos = fEvalPnl >= 0;

            return {
              Belnr:          r.Belnr,
              BudatFmt:       _fmtDate(r.Budat),
              Blart:          r.Blart,
              Fwaer:          sFwaer,
              Kunnr:          sKunnr,
              Lifnr:          sLifnr,
              Partner:        sKunnr || sLifnr || "-",
              WrbtrFmt:       bKrw || bZeroDecFx ? _fmtKrw(fWrbtrDisp) : _fmt(fWrbtr),
              // JPY: 1엔 단위
              KursfFmt:       bKrw ? "-" : _fmtKrw(fKursf),
              CurrentRateFmt: bKrw ? "-" : _fmtKrw(fCurrentUkurs),
              DmbtrFmt:       _fmtKrw(fDmbtr),
              EvalAmtFmt:     _fmtKrw(fEvalAmt),
              EvalPnlFmt:     bKrw ? "-" : (bPnlPos ? "▲ " : "▼ ") + _fmtKrw(Math.abs(fEvalPnl)),
              EvalPnlState:   bKrw ? "None" : (bPnlPos ? "Success" : "Error"),
              DaysOutstanding: nDays,
              OverdueFmt:     nDays > 0 ? nDays + " 일" : "-",
              OverdueState:   sOverdueState,
              _dmbtr:   fDmbtr,
              _evalAmt: fEvalAmt,
            };
          }).sort(function (a, b) {
            // 경과일 긴 순 → 금액 큰 순
            if (b.DaysOutstanding !== a.DaysOutstanding) return b.DaysOutstanding - a.DaysOutstanding;
            return b._dmbtr - a._dmbtr;
          });

          // 가장 오래된 미결 전표 summary
          if (aItems.length) {
            var oOldest = aItems[0];
            oVM.setProperty("/oldestInvoice/visible",         true);
            oVM.setProperty("/oldestInvoice/Belnr",           oOldest.Belnr);
            oVM.setProperty("/oldestInvoice/BudatFmt",        oOldest.BudatFmt);
            oVM.setProperty("/oldestInvoice/DaysOutstanding", oOldest.DaysOutstanding);
            oVM.setProperty("/oldestInvoice/Kunnr",           oOldest.Partner);
            oVM.setProperty("/oldestInvoice/OverdueState",    oOldest.OverdueState);
          }

          // BP 코드 목록 (value help용)
          var mPartnerMap = {};
          aItems.forEach(function (i) {
            if (i.Partner && i.Partner !== "-") mPartnerMap[i.Partner] = true;
          });
          oVM.setProperty("/partnerList",
            Object.keys(mPartnerMap).sort().map(function (k) { return { Partner: k }; }));

          // KPI 카드
          var aKpiCards = Object.keys(mByFwaer).map(function (key) {
            var s = mByFwaer[key];
            var bPnlPos = s.TotalEvalPnl >= 0;
            return {
              icon: s.IsKrw ? "sap-icon://home" : "sap-icon://money-bills",
              title:    s.Fwaer,
              subtitle: s.count + " 건",
              fwaer:    s.Fwaer,
              cssClass: "hbkCurrCard hbkCurrCard--" + key.toLowerCase(),
              totalWrbtrFmt: s.IsKrw || s.IsZeroDecFx ? _fmtKrw(s.TotalWrbtr) : _fmt(s.TotalWrbtr),
              totalDmbtrFmt: _fmtKrw(s.TotalDmbtr),
              evalPnlFmt:    s.IsKrw ? "-"
                : (bPnlPos ? "▲ " : "▼ ") + _fmtKrw(Math.abs(s.TotalEvalPnl)) + " 원",
              evalPnlClass:  s.IsKrw ? "hbkCurrKrw"
                : (bPnlPos ? "hbkEvalPnlPos" : "hbkEvalPnlNeg"),
              isKrw:       s.IsKrw,
              selected:    false,
              filterBtnType: "Default",
              _totalDmbtr: s.TotalDmbtr,
            };
          }).sort(function (a, b) {
            var ia = _ORDER.indexOf(a.fwaer), ib = _ORDER.indexOf(b.fwaer);
            if (ia < 0) ia = 99; if (ib < 0) ib = 99;
            return ia !== ib ? ia - ib : b._totalDmbtr - a._totalDmbtr;
          });

          // ── BP별 외화 노출도 ──────────────────────────────────
          var mBp = {};
          aItems.forEach(function (item) {
            var bp = (item.Partner && item.Partner !== "-") ? item.Partner : "(미기입)";
            mBp[bp] = (mBp[bp] || 0) + item._evalAmt;
          });
          var aBpArr = Object.keys(mBp)
            .map(function (k) { return { Partner: k, TotalEval: mBp[k] }; })
            .sort(function (a, b) { return b.TotalEval - a.TotalEval; });
          var aTop5 = aBpArr.slice(0, 5);
          var nOtherVal = aBpArr.slice(5).reduce(function (s, x) { return s + x.TotalEval; }, 0);
          if (nOtherVal > 0) aTop5.push({ Partner: "기타", TotalEval: nOtherVal });

          // ── Aging 분석 ────────────────────────────────────────
          var mAging = {};
          aItems.forEach(function (item) {
            var k = item.Fwaer;
            if (!mAging[k]) mAging[k] = { Fwaer: k, D0: 0, D1_30: 0, D31_60: 0, D61_90: 0, D91: 0 };
            var d = item.DaysOutstanding, v = item._evalAmt;
            if (d <= 0)       mAging[k].D0     += v;
            else if (d <= 30) mAging[k].D1_30  += v;
            else if (d <= 60) mAging[k].D31_60 += v;
            else if (d <= 90) mAging[k].D61_90 += v;
            else              mAging[k].D91    += v;
          });
          var aAgingArr = Object.keys(mAging)
            .map(function (k) { return mAging[k]; })
            .sort(function (a, b) {
              var ia = _ORDER.indexOf(a.Fwaer), ib = _ORDER.indexOf(b.Fwaer);
              return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
            });

          oVM.setProperty("/openItemsKpiCards",  aKpiCards);
          oVM.setProperty("/openItems",          aItems);
          oVM.setProperty("/selectedFwaer",      null);
          oVM.setProperty("/allBtnType",         "Emphasized");
          oVM.setProperty("/belnrFilter",        "");
          oVM.setProperty("/blartTypeFilter",    "ALL");
          var oBelnrInput = this.byId("idBelnrFilter");
          if (oBelnrInput) oBelnrInput.setValue("");
          oVM.setProperty("/page", 1);
          oVM.setProperty("/hasOpenItems", aItems.length > 0);
          this._updateBpChart(aTop5);
          this._updateAgingChart(aAgingArr);
          this._applyOpenItemsFilter();
        },

        // ── BP 코드 서치헬프 ──────────────────────────────────────
        onPartnerValueHelp: function () {
          if (!this._oPartnerDialog) {
            this._oPartnerDialog = new sap.m.SelectDialog({
              title:   "BP 코드 선택",
              confirm: this.onPartnerDialogConfirm.bind(this),
              cancel:  function (oEvent) { oEvent.getSource().getBinding("items").filter([]); },
              search:  function (oEvent) {
                var sVal = oEvent.getParameter("value");
                var aF   = sVal ? [new Filter("Partner", FilterOperator.Contains, sVal)] : [];
                oEvent.getSource().getBinding("items").filter(aF);
              },
              items: { path: "view>/partnerList", template: new sap.m.StandardListItem({ title: "{view>Partner}" }) },
            });
            this.getView().addDependent(this._oPartnerDialog);
          }
          this._oPartnerDialog.setModel(this.getView().getModel("view"), "view");
          this._oPartnerDialog.open();
        },

        onPartnerDialogConfirm: function (oEvent) {
          var oItem = oEvent.getParameter("selectedItem");
          if (oItem) {
            var sPartner = oItem.getTitle();
            this.byId("idPartnerFilter").setValue(sPartner);
            this.getView().getModel("view").setProperty("/partnerFilter", sPartner);
            this._applyOpenItemsFilter();
          }
          oEvent.getSource().getBinding("items").filter([]);
        },

        onPartnerFilterChange: function (oEvent) {
          var sVal = oEvent.getParameter("value") || "";
          this.getView().getModel("view").setProperty("/partnerFilter", sVal.trim());
          this._applyOpenItemsFilter();
        },

        onPartnerReset: function () {
          this.byId("idPartnerFilter").setValue("");
          this.getView().getModel("view").setProperty("/partnerFilter", "");
          this._applyOpenItemsFilter();
        },

        onBelnrFilterChange: function (oEvent) {
          this.getView().getModel("view").setProperty("/belnrFilter", (oEvent.getParameter("value") || "").trim());
          this._applyOpenItemsFilter();
        },

        onBelnrReset: function () {
          this.byId("idBelnrFilter").setValue("");
          this.getView().getModel("view").setProperty("/belnrFilter", "");
          this._applyOpenItemsFilter();
        },

        onBlartTypeChange: function (oEvent) {
          var oItem = oEvent.getParameter("item");
          this.getView().getModel("view").setProperty("/blartTypeFilter", oItem ? oItem.getKey() : "ALL");
          this._applyOpenItemsFilter();
        },

        _applyOpenItemsFilter: function () {
          var oVM        = this.getView().getModel("view");
          var sFwaer     = oVM.getProperty("/selectedFwaer");
          var sPartner   = (oVM.getProperty("/partnerFilter")   || "").trim();
          var sBelnr     = (oVM.getProperty("/belnrFilter")     || "").trim();
          var sBlartType = (oVM.getProperty("/blartTypeFilter") || "ALL");
          var aAll       = oVM.getProperty("/openItems");

          var aFiltered = aAll;
          if (sFwaer)    aFiltered = aFiltered.filter(function (i) { return i.Fwaer === sFwaer; });
          if (sPartner)  aFiltered = aFiltered.filter(function (i) { return i.Partner.toLowerCase().includes(sPartner.toLowerCase()); });
          if (sBelnr)    aFiltered = aFiltered.filter(function (i) { return i.Belnr.toLowerCase().includes(sBelnr.toLowerCase()); });
          if (sBlartType === "AR") aFiltered = aFiltered.filter(function (i) { return i.Kunnr !== ""; });
          if (sBlartType === "AP") aFiltered = aFiltered.filter(function (i) { return i.Lifnr !== ""; });

          var fTotalDmbtr = 0, fTotalEvalAmt = 0, nCount = aFiltered.length;
          aFiltered.forEach(function (i) { fTotalDmbtr += i._dmbtr; fTotalEvalAmt += i._evalAmt; });
          var sSummary = nCount > 0
            ? nCount + "건  |  전기금액: " + _fmtKrw(fTotalDmbtr) + " 원  |  평가금액: " + _fmtKrw(fTotalEvalAmt) + " 원"
            : "조회 결과 없음";
          oVM.setProperty("/openItemsFilteredSummary", sSummary);

          oVM.setProperty("/openItemsFiltered", aFiltered);
          oVM.setProperty("/openItemsCount", nCount ? String(nCount) : "");
          oVM.setProperty("/page", 1);
          this._applyPage(oVM);
        },

        // ── 전체 / KPI 필터 ───────────────────────────────────────
        onAllFilterPress: function () {
          var oVM = this.getView().getModel("view");
          oVM.setProperty("/selectedFwaer", null);
          oVM.setProperty("/allBtnType", "Emphasized");
          var aCards = oVM.getProperty("/openItemsKpiCards");
          aCards.forEach(function (c) { c.selected = false; c.filterBtnType = "Default"; });
          oVM.setProperty("/openItemsKpiCards", aCards);
          this._applyOpenItemsFilter();
        },

        onKpiCardPress: function (oEvent) {
          var sFwaer  = oEvent.getSource().data("fwaer");
          var oVM     = this.getView().getModel("view");
          var sCurrent = oVM.getProperty("/selectedFwaer");
          var sNext   = sCurrent === sFwaer ? null : sFwaer;
          oVM.setProperty("/selectedFwaer", sNext);
          var aCards = oVM.getProperty("/openItemsKpiCards");
          aCards.forEach(function (c) {
            c.selected = c.fwaer === sNext;
            c.filterBtnType = c.selected ? "Emphasized" : "Default";
          });
          oVM.setProperty("/openItemsKpiCards", aCards);
          oVM.setProperty("/allBtnType", sNext ? "Default" : "Emphasized");
          this._applyOpenItemsFilter();
        },

        // ── BP별 외화 노출도 도넛 차트 ────────────────────────────
        _updateBpChart: function (aBpData) {
          var oViz = this.byId("idBpExposureChart");
          if (!oViz) return;
          sap.ui.require(
            ["sap/viz/ui5/data/FlattenedDataset", "sap/viz/ui5/controls/common/feeds/FeedItem"],
            function (FlattenedDataset, FeedItem) {
              oViz.setVizType("donut");
              oViz.setModel(new JSONModel({ data: aBpData }));
              oViz.setDataset(new FlattenedDataset({
                dimensions: [{ name: "거래처", value: "{Partner}" }],
                measures:   [{ name: "KRW 평가금액", value: "{TotalEval}" }],
                data: { path: "/data" },
              }));
              oViz.removeAllFeeds();
              oViz.addFeed(new FeedItem({ uid: "size",  type: "Measure",   values: ["KRW 평가금액"] }));
              oViz.addFeed(new FeedItem({ uid: "color", type: "Dimension", values: ["거래처"] }));
              oViz.setVizProperties({
                title:    { visible: false },
                legend:   { visible: true, isScrollable: false },
                plotArea: { dataLabel: { visible: true, type: "percentage" } },
              });
            }
          );
        },

        // ── Aging 누적 막대 차트 ──────────────────────────────────
        _updateAgingChart: function (aAgingArr) {
          var oViz = this.byId("idAgingChart");
          if (!oViz) return;
          sap.ui.require(
            ["sap/viz/ui5/data/FlattenedDataset", "sap/viz/ui5/controls/common/feeds/FeedItem"],
            function (FlattenedDataset, FeedItem) {
              oViz.setVizType("stacked_column");
              oViz.setModel(new JSONModel({ data: aAgingArr }));
              oViz.setDataset(new FlattenedDataset({
                dimensions: [{ name: "통화", value: "{Fwaer}" }],
                measures: [
                  { name: "당일",    value: "{D0}" },
                  { name: "1~30일",  value: "{D1_30}" },
                  { name: "31~60일", value: "{D31_60}" },
                  { name: "61~90일", value: "{D61_90}" },
                  { name: "91일+",   value: "{D91}" },
                ],
                data: { path: "/data" },
              }));
              oViz.removeAllFeeds();
              oViz.addFeed(new FeedItem({ uid: "valueAxis",    type: "Measure",   values: ["당일", "1~30일", "31~60일", "61~90일", "91일+"] }));
              oViz.addFeed(new FeedItem({ uid: "categoryAxis", type: "Dimension", values: ["통화"] }));
              oViz.setVizProperties({
                title:   { visible: false },
                legend:  { visible: true, isScrollable: false },
                plotArea: {
                  dataLabel: { visible: false },
                  colorPalette: ["#107e3e", "#e9730c", "#c0392b", "#a93226", "#bb0000"],
                },
                valueAxis:    { title: { visible: true, text: "KRW (원)" } },
                categoryAxis: { title: { visible: false } },
              });
            }
          );
        },

        // ── Excel 내보내기 ────────────────────────────────────────
        onExport: function () {
          var aItems = this.getView().getModel("view").getProperty("/items");
          var sDate  = this.byId("idEvdat").getValue().replace(/-/g, "");
          sap.ui.require(["sap/ui/export/Spreadsheet"], function (Spreadsheet) {
            new Spreadsheet({
              workbook: {
                columns: [
                  { label: "하우스뱅크", property: "Hbkid" },
                  { label: "계좌 ID",    property: "Hktid" },
                  { label: "통화",       property: "Fwaer" },
                  { label: "잔액",       property: "WrbtrFmt" },
                  { label: "환율",       property: "UkursFmt" },
                  { label: "KRW 평가",   property: "EvalKrwFmt" },
                ],
              },
              dataSource: aItems,
              fileName: "외화보유현황_" + sDate + ".xlsx",
            }).build()
              .then(function () { MessageToast.show("Excel 다운로드 완료"); })
              .catch(function (e) { MessageBox.error("Excel 저장 실패: " + (e.message || "")); });
          }.bind(this));
        },
      },
    );
  },
);
