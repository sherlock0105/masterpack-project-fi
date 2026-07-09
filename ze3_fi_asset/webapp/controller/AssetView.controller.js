sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/ui/export/Spreadsheet"
], function (Controller, JSONModel, MessageBox, Spreadsheet) {
    "use strict";

    var ANLKL_NAMES = {
        "BD": "건물",
        "MC": "기계장치",
        "VH": "운반구",
        "FE": "비품",
        "LD": "토지"
    };

    var AFASL_LABELS = {
        "LINR": "정액법",
        "DECL": "정률법",
        "NONE": "해당없음"
    };

    function _fmtAmt(n) {
        return Math.round(parseFloat(n) || 0).toLocaleString("ko-KR");
    }

    function _fmtDate(d) {
        if (!d) return "";
        var dt;
        if (d instanceof Date) {
            dt = d;
        } else {
            var m = String(d).match(/\/Date\((\d+)\)\//);
            if (m) {
                dt = new Date(parseInt(m[1], 10));
            } else {
                return String(d);
            }
        }
        return dt.getUTCFullYear() + "년 "
            + ("0" + (dt.getUTCMonth() + 1)).slice(-2) + "월 "
            + ("0" + dt.getUTCDate()).slice(-2) + "일";
    }

    function _toKpiParts(n) {
        var f = Math.round(Math.abs(parseFloat(n) || 0));
        if (f >= 1e8) return { val: (f / 1e8).toFixed(1), scale: "억원" };
        if (f >= 1e6) return { val: (f / 1e6).toFixed(0),  scale: "백만원" };
        return { val: _fmtAmt(f), scale: "원" };
    }

    // 취득일 + 내용연수(년) → 상각 종료 예정일
    function _calcDeprEndDate(abudat, alife) {
        var nLife = parseInt(alife, 10);
        if (!abudat || isNaN(nLife) || nLife <= 0) return null;
        var dt;
        if (abudat instanceof Date) {
            dt = new Date(abudat.getTime());
        } else {
            var m = String(abudat).match(/\/Date\((\d+)\)\//);
            if (!m) return null;
            dt = new Date(parseInt(m[1], 10));
        }
        dt.setUTCFullYear(dt.getUTCFullYear() + nLife);
        return dt;
    }

    // 종료일까지 남은 개월 수 (음수 = 이미 완료)
    function _remainingMonths(endDate) {
        if (!endDate) return null;
        return Math.floor((endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30.44));
    }

    return Controller.extend("zpe3.fi.asset.zpe3fiasset.controller.AssetView", {

        onInit: function () {
            this.getView().setModel(new JSONModel({
                busy:          false,
                hasData:       false,
                hasTrend:      false,
                gjahr:         String(new Date().getFullYear()),
                selectedAnlkl: "",
                rawData:       [],
                summaryText:   "",
                kpi: {
                    countVal: "0",  countText: "",
                    apriceVal: "0", apriceScale: "원", apriceText: "",
                    accumVal:  "0", accumScale:  "원", accumText:  "",
                    bookVal:   "0", bookScale:   "원", bookText:   ""
                },
                alerts: { soonExpiring: 0, disposed: 0, hasSoonExpiring: false },
                tableItems:    [],
                yearlyTrend:   [],
                top5Data:      [],
                costCenterData: [],
                afaslData:     []
            }), "view");
        },

        onAfterRendering: function () {
            if (this._bInitDone) return;
            this._bInitDone = true;
            this.getOwnerComponent().getModel().metadataLoaded().then(function () {
                this.onSearch();
            }.bind(this));
        },

        // ── 서버 조회 ─────────────────────────────────────────
        onSearch: function () {
            var oVM    = this.getView().getModel("view");
            var sGjahr = String(oVM.getProperty("/gjahr") || "").trim();

            if (!/^\d{4}$/.test(sGjahr)) {
                MessageBox.warning("회계연도 4자리를 입력하세요.");
                return;
            }

            oVM.setProperty("/busy",        true);
            oVM.setProperty("/hasData",     false);
            oVM.setProperty("/summaryText", "");
            oVM.setProperty("/selectedAnlkl", "");

            this.getOwnerComponent().getModel().read("/Asset(p_gjahr='" + sGjahr + "')/Set", {
                success: function (d) {
                    oVM.setProperty("/busy", false);
                    var aResults = d.results || [];
                    if (!aResults.length) {
                        oVM.setProperty("/hasData", false);
                        return;
                    }
                    oVM.setProperty("/rawData", aResults);
                    this._applyFilter();
                }.bind(this),
                error: function (e) {
                    oVM.setProperty("/busy", false);
                    var sMsg = "조회 오류";
                    try { sMsg += ": " + JSON.parse(e.responseText).error.message.value; } catch (x) {}
                    MessageBox.error(sMsg);
                }.bind(this)
            });
        },

        // ── 자산분류 Select 변경 → 로컬 필터 ─────────────────
        onClassChange: function () {
            var oVM = this.getView().getModel("view");
            if (!(oVM.getProperty("/rawData") || []).length) return;
            this._applyFilter();
        },

        // ── 초기화 ────────────────────────────────────────────
        onReset: function () {
            var oVM = this.getView().getModel("view");
            oVM.setProperty("/gjahr",         String(new Date().getFullYear()));
            oVM.setProperty("/selectedAnlkl", "");
            oVM.setProperty("/hasData",       false);
            oVM.setProperty("/hasTrend",      false);
            oVM.setProperty("/rawData",       []);
            oVM.setProperty("/tableItems",    []);
            oVM.setProperty("/yearlyTrend",   []);
            oVM.setProperty("/top5Data",      []);
            oVM.setProperty("/costCenterData", []);
            oVM.setProperty("/afaslData",     []);
            oVM.setProperty("/alerts",        { soonExpiring: 0, disposed: 0, hasSoonExpiring: false });
        },

        // ── Excel 내보내기 ────────────────────────────────────
        onExport: function () {
            var oVM    = this.getView().getModel("view");
            var aItems = oVM.getProperty("/tableItems") || [];
            if (!aItems.length) return;

            var aCols = [
                { label: "자산코드",         property: "Anln1"        },
                { label: "자산명",           property: "Anlnt"        },
                { label: "자산분류",         property: "AnlklName"    },
                { label: "취득가액 (원)",    property: "ApriceFmt"    },
                { label: "감가누계 (원)",    property: "AccumFmt"     },
                { label: "장부가액 (원)",    property: "BookValueFmt" },
                { label: "취득일",           property: "AbudatFmt"    },
                { label: "상각 종료 예정일", property: "EndDateFmt"   },
                { label: "잔여(개월)",       property: "RemainDisp"   },
                { label: "코스트센터",       property: "Kostl"        },
                { label: "감가방법",         property: "Afasl"        },
                { label: "상태",             property: "Status"       }
            ];

            new Spreadsheet({
                workbook:   { columns: aCols },
                dataSource: aItems,
                fileName:   "고정자산_" + (oVM.getProperty("/gjahr") || "") + ".xlsx"
            }).build().then(function () {}).catch(function (err) {
                MessageBox.error("Excel 저장 오류: " + (err.message || err));
            });
        },

        // ── 클라이언트 필터 적용 후 화면 갱신 ─────────────────
        _applyFilter: function () {
            var oVM    = this.getView().getModel("view");
            var aRaw   = oVM.getProperty("/rawData") || [];
            var sAnlkl = oVM.getProperty("/selectedAnlkl") || "";
            var sGjahr = String(oVM.getProperty("/gjahr") || "").trim();

            var aFiltered = sAnlkl
                ? aRaw.filter(function (r) { return r.Anlkl === sAnlkl; })
                : aRaw;

            if (!aFiltered.length) {
                oVM.setProperty("/hasData", false);
                return;
            }
            this._processData(aFiltered, oVM, sGjahr);
        },

        // ── 데이터 가공 및 화면 반영 ──────────────────────────
        _processData: function (aRaw, oVM, sGjahr) {
            var fTotalAprice = 0, fTotalAccum = 0, fTotalBook = 0;
            var MONTHS = ["01","02","03","04","05","06","07","08","09","10","11","12"];
            var mMonths = {};
            MONTHS.forEach(function (m) { mMonths[m] = 0; });
            var mByClass = {};
            var mKostl   = {};
            var mAfasl   = {};
            var nSoonExpiring = 0;
            var nDisposed     = 0;

            var aTableItems = aRaw.map(function (r) {
                var fAprice = parseFloat(r.Aprice)    || 0;
                var fAccum  = parseFloat(r.Accum)     || 0;
                var fBook   = parseFloat(r.BookValue) || 0;
                fTotalAprice += fAprice;
                fTotalAccum  += fAccum;
                fTotalBook   += fBook;

                MONTHS.forEach(function (m) {
                    mMonths[m] += parseFloat(r["M" + m]) || 0;
                });

                var sCode = r.Anlkl || "기타";
                var sName = ANLKL_NAMES[sCode] || sCode;
                if (!mByClass[sCode]) {
                    mByClass[sCode] = { AnlklName: sName, Aprice: 0, BookValue: 0 };
                }
                mByClass[sCode].Aprice    += fAprice;
                mByClass[sCode].BookValue += fBook;

                // 코스트센터별 장부가액
                var sKostl = (r.Kostl || "").trim() || "미배부";
                if (!mKostl[sKostl]) mKostl[sKostl] = 0;
                mKostl[sKostl] += fBook;

                // 감가방법 분포
                var sAfaslLabel = AFASL_LABELS[r.Afasl] || (r.Afasl || "미지정");
                if (!mAfasl[sAfaslLabel]) mAfasl[sAfaslLabel] = 0;
                mAfasl[sAfaslLabel] += 1;

                // 상각 종료 예정일 & 잔여 내용연수
                var oEndDate = _calcDeprEndDate(r.Abudat, r.Alife);
                var nRemMo   = _remainingMonths(oEndDate);
                var bSoon    = nRemMo !== null && nRemMo >= 0 && nRemMo <= 3;
                if (bSoon) nSoonExpiring++;

                // 처분 여부
                var bDisposed = (r.Abflg || "") === "X";
                if (bDisposed) nDisposed++;

                var sRemDisplay = nRemMo === null  ? "-"
                                : nRemMo < 0      ? "상각완료"
                                : String(nRemMo)  + "개월";

                return {
                    Anln1:        r.Anln1,
                    AnlklName:    ANLKL_NAMES[r.Anlkl] || r.Anlkl,
                    Anlnt:        r.Anlnt,
                    ApriceFmt:    _fmtAmt(fAprice),
                    AccumFmt:     _fmtAmt(fAccum),
                    BookValueFmt: _fmtAmt(fBook),
                    AbudatFmt:    _fmtDate(r.Abudat),
                    EndDateFmt:   oEndDate ? _fmtDate(oEndDate) : "-",
                    RemainDisp:   sRemDisplay,
                    Kostl:        r.Kostl,
                    Afasl:        AFASL_LABELS[r.Afasl] || r.Afasl,
                    Status:       bDisposed ? "처분" : "정상",
                    RowHighlight: bSoon ? "Warning" : "None"
                };
            });

            var nCount  = aRaw.length;
            var oAprice = _toKpiParts(fTotalAprice);
            var oAccum  = _toKpiParts(fTotalAccum);
            var oBook   = _toKpiParts(fTotalBook);

            oVM.setProperty("/kpi/countVal",    String(nCount));
            oVM.setProperty("/kpi/countText",   nCount.toLocaleString("ko-KR") + " 건");
            oVM.setProperty("/kpi/apriceVal",   oAprice.val);
            oVM.setProperty("/kpi/apriceScale", oAprice.scale);
            oVM.setProperty("/kpi/apriceText",  _fmtAmt(fTotalAprice) + " 원");
            oVM.setProperty("/kpi/accumVal",    oAccum.val);
            oVM.setProperty("/kpi/accumScale",  oAccum.scale);
            oVM.setProperty("/kpi/accumText",   _fmtAmt(fTotalAccum) + " 원");
            oVM.setProperty("/kpi/bookVal",     oBook.val);
            oVM.setProperty("/kpi/bookScale",   oBook.scale);
            oVM.setProperty("/kpi/bookText",    _fmtAmt(fTotalBook) + " 원");

            var sAnlkl     = oVM.getProperty("/selectedAnlkl") || "";
            var sClassName = sAnlkl ? " | [" + (ANLKL_NAMES[sAnlkl] || sAnlkl) + "]" : "";
            oVM.setProperty("/summaryText",
                sGjahr + "년" + sClassName +
                "  |  자산 " + nCount + " 건" +
                "  |  취득가액 " + _fmtAmt(fTotalAprice) + " 원" +
                "  |  장부가액 " + _fmtAmt(fTotalBook) + " 원");

            oVM.setProperty("/tableItems", aTableItems);
            oVM.setProperty("/hasData", true);

            // ── TOP 5 (장부가액 기준) ──────────────────────────
            var aTop5 = aRaw.slice()
                .sort(function (a, b) { return (parseFloat(b.BookValue) || 0) - (parseFloat(a.BookValue) || 0); })
                .slice(0, 5)
                .map(function (r, idx) {
                    return {
                        rank:         idx + 1,
                        Anln1:        r.Anln1,
                        Anlnt:        r.Anlnt,
                        AnlklName:    ANLKL_NAMES[r.Anlkl] || r.Anlkl,
                        BookValueFmt: _fmtAmt(parseFloat(r.BookValue) || 0)
                    };
                });

            // ── 코스트센터 도넛 (5% 미만 → 기타) ─────────────
            var aKostlRaw = Object.keys(mKostl)
                .map(function (k) { return { label: k, val: mKostl[k] }; })
                .sort(function (a, b) { return b.val - a.val; });
            var aKostlMain = [], nKostlOther = 0;
            aKostlRaw.forEach(function (d) {
                if (fTotalBook > 0 && d.val / fTotalBook >= 0.05) {
                    aKostlMain.push(d);
                } else {
                    nKostlOther += d.val;
                }
            });
            if (nKostlOther > 0) aKostlMain.push({ label: "기타", val: nKostlOther });

            // ── 감가방법 분포 ──────────────────────────────────
            var aAfaslData = Object.keys(mAfasl)
                .map(function (k) { return { label: k, count: mAfasl[k] }; })
                .sort(function (a, b) { return b.count - a.count; });

            // ── 알림 집계 ──────────────────────────────────────
            oVM.setProperty("/alerts", {
                soonExpiring:    nSoonExpiring,
                disposed:        nDisposed,
                hasSoonExpiring: nSoonExpiring > 0
            });
            oVM.setProperty("/top5Data",       aTop5);
            oVM.setProperty("/costCenterData", aKostlMain);
            oVM.setProperty("/afaslData",      aAfaslData);

            var aClassData = Object.keys(mByClass)
                .map(function (k) { return mByClass[k]; })
                .sort(function (a, b) { return b.BookValue - a.BookValue; });

            var aMonthData = MONTHS.map(function (m) {
                return { Month: m + "월", Depr: mMonths[m] };
            });

            this._updateClassChart(aClassData);
            this._updateMonthlyChart(aMonthData);
            this._updateKostlDonut(aKostlMain);
            this._updateAfaslDonut(aAfaslData);
            this._loadTrendData(sGjahr, oVM.getProperty("/selectedAnlkl") || "");
        },

        _updateClassChart: function (aData) {
            var oViz = this.byId("idClassChart");
            if (!oViz) return;
            sap.ui.require(
                ["sap/viz/ui5/data/FlattenedDataset", "sap/viz/ui5/controls/common/feeds/FeedItem"],
                function (FlattenedDataset, FeedItem) {
                    oViz.setVizType("bar");
                    oViz.setModel(new JSONModel({ data: aData }));
                    oViz.setDataset(new FlattenedDataset({
                        dimensions: [{ name: "자산클래스", value: "{AnlklName}" }],
                        measures: [
                            { name: "취득가액",  value: "{Aprice}"    },
                            { name: "장부가액",  value: "{BookValue}" }
                        ],
                        data: { path: "/data" }
                    }));
                    if (!oViz.getFeeds().length) {
                        oViz.addFeed(new FeedItem({ uid: "valueAxis",    type: "Measure",   values: ["취득가액", "장부가액"] }));
                        oViz.addFeed(new FeedItem({ uid: "categoryAxis", type: "Dimension", values: ["자산클래스"] }));
                    }
                    oViz.setVizProperties({
                        title:        { visible: false },
                        legend:       { visible: true },
                        plotArea:     { dataLabel: { visible: false }, colorPalette: ["#1565c0", "#43a047"] },
                        valueAxis:    { title: { visible: true, text: "금액 (원)" } },
                        categoryAxis: { title: { visible: false } }
                    });
                }
            );
        },

        _updateKostlDonut: function (aData) {
            var oViz = this.byId("idKostlDonut");
            if (!oViz) return;
            sap.ui.require(
                ["sap/viz/ui5/data/FlattenedDataset", "sap/viz/ui5/controls/common/feeds/FeedItem"],
                function (FlattenedDataset, FeedItem) {
                    oViz.setVizType("donut");
                    oViz.setModel(new JSONModel({ data: aData }));
                    oViz.setDataset(new FlattenedDataset({
                        dimensions: [{ name: "코스트센터", value: "{label}" }],
                        measures:   [{ name: "장부가액",   value: "{val}"   }],
                        data: { path: "/data" }
                    }));
                    oViz.removeAllFeeds();
                    oViz.addFeed(new FeedItem({ uid: "size",  type: "Measure",   values: ["장부가액"] }));
                    oViz.addFeed(new FeedItem({ uid: "color", type: "Dimension", values: ["코스트센터"] }));
                    oViz.setVizProperties({
                        title:  { visible: false },
                        legend: { visible: true, position: "bottom" },
                        plotArea: {
                            dataLabel: { visible: true, type: "percentage",
                                         formatString: "#,##0.0%", hideWhenOverlap: true }
                        }
                    });
                }
            );
        },

        _updateAfaslDonut: function (aData) {
            var oViz = this.byId("idAfaslDonut");
            if (!oViz) return;
            sap.ui.require(
                ["sap/viz/ui5/data/FlattenedDataset", "sap/viz/ui5/controls/common/feeds/FeedItem"],
                function (FlattenedDataset, FeedItem) {
                    oViz.setVizType("donut");
                    oViz.setModel(new JSONModel({ data: aData }));
                    oViz.setDataset(new FlattenedDataset({
                        dimensions: [{ name: "감가방법", value: "{label}" }],
                        measures:   [{ name: "자산 수",  value: "{count}" }],
                        data: { path: "/data" }
                    }));
                    oViz.removeAllFeeds();
                    oViz.addFeed(new FeedItem({ uid: "size",  type: "Measure",   values: ["자산 수"] }));
                    oViz.addFeed(new FeedItem({ uid: "color", type: "Dimension", values: ["감가방법"] }));
                    oViz.setVizProperties({
                        title:  { visible: false },
                        legend: { visible: true, position: "bottom" },
                        plotArea: {
                            dataLabel: { visible: true, type: "percentage",
                                         formatString: "#,##0.0%", hideWhenOverlap: true }
                        }
                    });
                }
            );
        },

        // ── 연도별 추이 데이터 로딩 (현재연도 ±2년) ──────────────
        _loadTrendData: function (sGjahr, sAnlkl) {
            var oVM    = this.getView().getModel("view");
            var oModel = this.getOwnerComponent().getModel();
            var nYear  = parseInt(sGjahr, 10);
            var aYears = [nYear - 2, nYear - 1, nYear];
            var mResult  = {};
            var nPending = aYears.length;
            var that = this;

            aYears.forEach(function (nY) {
                var sY = String(nY);
                oModel.read("/Asset(p_gjahr='" + sY + "')/Set", {
                    success: function (d) {
                        var aR = d.results || [];
                        if (sAnlkl) {
                            aR = aR.filter(function (r) { return r.Anlkl === sAnlkl; });
                        }
                        var fA = 0, fAc = 0, fB = 0;
                        aR.forEach(function (r) {
                            fA  += parseFloat(r.Aprice)    || 0;
                            fAc += parseFloat(r.Accum)     || 0;
                            fB  += parseFloat(r.BookValue) || 0;
                        });
                        mResult[sY] = { year: sY, aprice: fA, accum: fAc, book: fB, count: aR.length };
                        if (--nPending === 0) that._buildTrend(mResult, aYears, oVM);
                    },
                    error: function () {
                        if (--nPending === 0) that._buildTrend(mResult, aYears, oVM);
                    }
                });
            });
        },

        _buildTrend: function (mResult, aYears, oVM) {
            var aTrend = aYears.map(function (nY) { return mResult[String(nY)]; }).filter(Boolean);
            if (aTrend.length < 2) { oVM.setProperty("/hasTrend", false); return; }

            aTrend.forEach(function (o, i) {
                if (i === 0) {
                    o.bookDeltaFmt = "-"; o.apriceDeltaFmt = "-";
                    o.bookDeltaState = "None"; o.apriceDeltaState = "None";
                } else {
                    var prev = aTrend[i - 1];
                    var dB = prev.book   > 0 ? ((o.book   - prev.book)   / prev.book   * 100) : 0;
                    var dA = prev.aprice > 0 ? ((o.aprice - prev.aprice) / prev.aprice * 100) : 0;
                    dB = Math.round(dB * 10) / 10;
                    dA = Math.round(dA * 10) / 10;
                    o.bookDeltaFmt   = (dB >= 0 ? "+" : "") + dB + "%";
                    o.apriceDeltaFmt = (dA >= 0 ? "+" : "") + dA + "%";
                    o.bookDeltaState   = dB > 3 ? "Success" : dB < -3 ? "Error" : "Warning";
                    o.apriceDeltaState = dA > 0 ? "Success" : dA < 0 ? "Error" : "None";
                }
                o.bookFmt   = _fmtAmt(o.book);
                o.apriceFmt = _fmtAmt(o.aprice);
                o.accumFmt  = _fmtAmt(o.accum);
                o.yearLabel = o.year + "년";
            });

            oVM.setProperty("/yearlyTrend", aTrend);
            oVM.setProperty("/hasTrend", true);
            this._updateTrendChart(aTrend);
        },

        _updateTrendChart: function (aData) {
            var oViz = this.byId("idTrendChart");
            if (!oViz) return;
            sap.ui.require(
                ["sap/viz/ui5/data/FlattenedDataset", "sap/viz/ui5/controls/common/feeds/FeedItem"],
                function (FlattenedDataset, FeedItem) {
                    oViz.setVizType("combination");
                    oViz.setModel(new JSONModel({ data: aData }));
                    oViz.setDataset(new FlattenedDataset({
                        dimensions: [{ name: "연도", value: "{yearLabel}" }],
                        measures: [
                            { name: "취득가액",  value: "{aprice}" },
                            { name: "장부가액",  value: "{book}"   },
                            { name: "감가누계",  value: "{accum}"  }
                        ],
                        data: { path: "/data" }
                    }));
                    oViz.removeAllFeeds();
                    oViz.addFeed(new FeedItem({ uid: "valueAxis",    type: "Measure",
                                                values: ["취득가액", "장부가액", "감가누계"] }));
                    oViz.addFeed(new FeedItem({ uid: "categoryAxis", type: "Dimension", values: ["연도"] }));
                    oViz.setVizProperties({
                        title:  { visible: false },
                        legend: { visible: true },
                        plotArea: {
                            dataLabel: { visible: true },
                            colorPalette: ["#1565c0", "#2e7d32", "#e65100"]
                        },
                        valueAxis:    { title: { visible: true, text: "금액 (원)" } },
                        categoryAxis: { title: { visible: false } }
                    });
                }
            );
        },

        _updateMonthlyChart: function (aData) {
            var oViz = this.byId("idMonthChart");
            if (!oViz) return;
            sap.ui.require(
                ["sap/viz/ui5/data/FlattenedDataset", "sap/viz/ui5/controls/common/feeds/FeedItem"],
                function (FlattenedDataset, FeedItem) {
                    oViz.setVizType("column");
                    oViz.setModel(new JSONModel({ data: aData }));
                    oViz.setDataset(new FlattenedDataset({
                        dimensions: [{ name: "월",     value: "{Month}" }],
                        measures:   [{ name: "감가상각", value: "{Depr}"  }],
                        data: { path: "/data" }
                    }));
                    if (!oViz.getFeeds().length) {
                        oViz.addFeed(new FeedItem({ uid: "valueAxis",    type: "Measure",   values: ["감가상각"] }));
                        oViz.addFeed(new FeedItem({ uid: "categoryAxis", type: "Dimension", values: ["월"] }));
                    }
                    oViz.setVizProperties({
                        title:        { visible: false },
                        legend:       { visible: false },
                        plotArea:     { dataLabel: { visible: true }, colorPalette: ["#e65100"] },
                        valueAxis:    { title: { visible: true, text: "감가상각 (원)" } },
                        categoryAxis: { title: { visible: false } }
                    });
                }
            );
        }
    });
});
