sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (Controller, JSONModel, Filter, FilterOperator, MessageToast, MessageBox) {
    "use strict";

    function _fmtDate(d) {
        if (!d) return "";
        if (typeof d === "string") {
            var m = d.match(/\/Date\((\d+)\)\//);
            if (m) d = new Date(parseInt(m[1], 10));
            else return d;
        }
        if (!(d instanceof Date)) return String(d);
        return d.getUTCFullYear() + "-" +
               ("0" + (d.getUTCMonth() + 1)).slice(-2) + "-" +
               ("0" + d.getUTCDate()).slice(-2);
    }

    function _fmtQty(n) {
        var v = parseFloat(n) || 0;
        if (v === 0) return "0";
        return v % 1 === 0
            ? v.toLocaleString("ko-KR")
            : v.toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 3 });
    }

    function _defectState(fRate) {
        if (fRate === null) return "None";
        if (fRate >= 10) return "Error";
        if (fRate >= 3)  return "Warning";
        return "Success";
    }

    function _yyyymmdd(oDate) {
        return oDate.getFullYear() +
               ("0" + (oDate.getMonth() + 1)).slice(-2) +
               ("0" + oDate.getDate()).slice(-2);
    }

    function _iso(s) {
        return s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8);
    }

    var QM_DEFAULT_ITEMS = [
        { InspCd: "1",  InspNm: "색상",      Meins: "" },
        { InspCd: "2",  InspNm: "이물질",    Meins: "" },
        { InspCd: "10", InspNm: "PH",        Meins: "" },
        { InspCd: "11", InspNm: "용량",      Meins: "" },
        { InspCd: "12", InspNm: "납/수은",   Meins: "" },
        { InspCd: "20", InspNm: "방부제",    Meins: "" },
        { InspCd: "21", InspNm: "밀봉/상태", Meins: "" },
        { InspCd: "31", InspNm: "라벨/LOT",  Meins: "" }
    ];

    function _defaultItems() {
        return QM_DEFAULT_ITEMS.map(function (i) { return Object.assign({}, i); });
    }

    return Controller.extend("ze3.qm.insp.ze3qminsp.controller.InspView", {

        onInit: function () {
            var oToday = new Date();
            var oFrom  = new Date(oToday.getFullYear(), oToday.getMonth(), 1);

            this.getView().setModel(new JSONModel({
                busy: false,
                hasData: false,
                hasChart: false,
                hasMonthly: false,
                showDetail: false,
                selectedPrueflos: "",
                summaryText: "",
                allHeaders: [],
                headers: [],
                claimHeaders: [],
                hasClaimData: false,
                claimSummaryText: "",
                matnrList: [],
                monthlyData: [],
                kpiVisible: false,
                kpi: {
                    thisMonth: { label: "", doneCount: 0, failCount: 0, waitCount: 0, rate: "0.0%" },
                    lastMonth: { label: "", doneCount: 0, failCount: 0, waitCount: 0, rate: "0.0%" }
                },
                insp: {
                    header: {},
                    items: [],
                    total: 0,
                    isCompleted: false
                },
                result: {
                    header: {},
                    passQtyFmt: "0",
                    failQtyFmt: "0",
                    defectRate: "0.0%",
                    meins: "",
                    items: []
                }
            }), "view");

            this.byId("idBudatFrom").setValue(_yyyymmdd(oFrom));
            this.byId("idBudatTo").setValue(_yyyymmdd(oToday));
        },

        onAfterRendering: function () {
            if (this._bInitDone) return;
            this._bInitDone = true;
            this.getOwnerComponent().getModel().metadataLoaded().then(function () {
                this.onSearch();
                this._loadMonthlyKpi();
            }.bind(this));
        },

        // ══ 조회 ══════════════════════════════════════════════════
        onSearch: function () {
            var sFrom  = (this.byId("idBudatFrom").getValue() || "").replace(/-/g, "");
            var sTo    = (this.byId("idBudatTo").getValue()   || "").replace(/-/g, "");
            var sMatnr = this.byId("idMatnr").getValue().trim();

            if (!sFrom || !sTo) { MessageToast.show("검수 기간을 선택해주세요."); return; }
            if (sFrom > sTo)    { MessageToast.show("시작일이 종료일보다 늦을 수 없습니다."); return; }

            var oVM = this.getView().getModel("view");
            oVM.setProperty("/busy", true);
            oVM.setProperty("/hasData", false);
            oVM.setProperty("/hasChart", false);
            oVM.setProperty("/showDetail", false);
            oVM.setProperty("/selectedPrueflos", "");
            oVM.setProperty("/allHeaders", []);
            oVM.setProperty("/headers", []);

            var sFilter =
                "Budat ge datetime'" + _iso(sFrom) + "T00:00:00'" +
                " and Budat le datetime'" + _iso(sTo) + "T23:59:59'";
            if (sMatnr) sFilter += " and Matnr eq '" + sMatnr + "'";

            this.getOwnerComponent().getModel().read("/InspHeaderSet", {
                urlParameters: { $filter: sFilter },
                success: function (d) {
                    oVM.setProperty("/busy", false);
                    var aRaw = d.results || [];
                    if (!aRaw.length) {
                        MessageToast.show("조회된 데이터가 없습니다.");
                        return;
                    }
                    this._processHeaders(aRaw, oVM);
                }.bind(this),
                error: function (e) {
                    oVM.setProperty("/busy", false);
                    var sMsg = e.message || "조회 오류";
                    try { sMsg = JSON.parse(e.responseText).error.message.value; } catch (x) {}
                    MessageBox.error("조회 오류: " + sMsg);
                }
            });
        },

        _processHeaders: function (aRaw, oVM) {
            var aAll = aRaw.map(function (r) {
                var fPass = parseFloat(r.PassQty) || 0;
                var fFail = parseFloat(r.FailQty) || 0;
                var fQi   = parseFloat(r.QiQty)   || 0;
                var fDone = fPass + fFail;
                var bCompleted = fDone > 0;
                var fRate = bCompleted ? (fFail / fDone * 100) : null;

                return {
                    Prueflos:        r.Prueflos,
                    PruefPos:        r.PruefPos,
                    Matnr:           r.Matnr  || "",
                    Maktx:           r.Maktx  || "",
                    Charg:           r.Charg  || "",
                    Pernr:           r.Pernr  || "",
                    Meins:           r.Meins  || "",
                    BudatFmt:        _fmtDate(r.Budat),
                    GltrpFmt:        _fmtDate(r.Gltrp),
                    QiQtyFmt:        _fmtQty(fQi),
                    PassQtyFmt:      _fmtQty(fPass),
                    FailQtyFmt:      _fmtQty(fFail),
                    DefectRateFmt:   fRate !== null ? (Math.round(fRate * 10) / 10) + "%" : "-",
                    DefectRateState: _defectState(fRate),
                    DefectRate:      fRate !== null ? Math.round(fRate * 10) / 10 : 0,
                    StatusDisplay:   bCompleted ? "검사완료" : "검사대기",
                    StatusState:     bCompleted ? "Success"  : "Warning",
                    _passQty:        fPass,
                    _failQty:        fFail,
                    _qiQty:          fQi,
                    isCompleted:     bCompleted
                };
            });

            oVM.setProperty("/allHeaders", aAll);
            oVM.setProperty("/hasData", true);
            this._applyStatusFilter(oVM);
        },

        // ══ 상태 필터 ═════════════════════════════════════════════
        onStatusFilterChange: function () {
            var oVM = this.getView().getModel("view");
            if (!oVM.getProperty("/hasData")) return;
            this._applyStatusFilter(oVM);
        },

        _applyStatusFilter: function (oVM) {
            oVM = oVM || this.getView().getModel("view");
            var sKey = this.byId("idStats").getSelectedKey();
            var aAll = oVM.getProperty("/allHeaders") || [];

            var aFiltered = !sKey           ? aAll
                          : sKey === "wait" ? aAll.filter(function (h) { return !h.isCompleted; })
                          :                   aAll.filter(function (h) { return  h.isCompleted; });

            oVM.setProperty("/headers", aFiltered);
            this._computeKpiAndChart(aFiltered, oVM);

            var nAll = aAll.length, nShown = aFiltered.length;
            oVM.setProperty("/summaryText",
                "검수 " + nShown + " 건 표시" + (nShown < nAll ? " (전체 " + nAll + " 건 중)" : "") +
                "  |  검사대기 " + aFiltered.filter(function(h){return !h.isCompleted;}).length + " 건" +
                "  |  검사완료 " + aFiltered.filter(function(h){return h.isCompleted;}).length + " 건"
            );

            // 클레임 = 완료 + 불합격수량 > 0 (상태 필터 무관, 전체 기준)
            var aClaims = aAll.filter(function (h) { return h.isCompleted && h._failQty > 0; });
            oVM.setProperty("/claimHeaders", aClaims);
            oVM.setProperty("/hasClaimData", aClaims.length > 0);
            var nFailTotal = aClaims.reduce(function (s, h) { return s + h._failQty; }, 0);
            oVM.setProperty("/claimSummaryText",
                "불합격 LOT " + aClaims.length + " 건  |  불합격 수량 합계: " + _fmtQty(nFailTotal) + " EA");
        },

        _computeKpiAndChart: function (aHeaders, oVM) {
            var nWait = 0, fWaitQty = 0;
            var nDone = 0, fDoneQty = 0;
            var nFail = 0, fFailQty = 0;
            var aChart = [];

            aHeaders.forEach(function (h) {
                if (h.isCompleted) {
                    nDone++;
                    fDoneQty += h._passQty + h._failQty;
                    aChart.push({ Lot: h.Prueflos, DefectRate: h.DefectRate,
                                  PassQty: h._passQty, FailQty: h._failQty });
                } else {
                    nWait++;
                    fWaitQty += h._qiQty;
                }
                if (h._failQty > 0) { nFail++; fFailQty += h._failQty; }
            });

            aChart.sort(function (a, b) { return b.DefectRate - a.DefectRate; });

            oVM.setProperty("/hasChart", aChart.length > 0);
            if (aChart.length) this._updateChart(aChart);

            var aAllHeaders = oVM.getProperty("/allHeaders") || [];
            this._buildMonthlyData(aAllHeaders, oVM);
        },

        // ══ 월별 폐기현황 ═══════════════════════════════════════════
        _buildMonthlyData: function (aAll, oVM) {
            var mMonth = {};
            aAll.forEach(function (h) {
                if (!h.isCompleted) return;
                var sMon = h.BudatFmt ? h.BudatFmt.slice(0, 7) : "";
                if (!sMon) return;
                if (!mMonth[sMon]) {
                    mMonth[sMon] = { month: sMon, totalLots: 0, failLots: 0, passLots: 0, failQty: 0 };
                }
                mMonth[sMon].totalLots++;
                if (h._failQty > 0) {
                    mMonth[sMon].failLots++;
                    mMonth[sMon].failQty += h._failQty;
                } else {
                    mMonth[sMon].passLots++;
                }
            });

            var aMonthly = Object.keys(mMonth).sort().map(function (k) {
                var m = mMonth[k];
                var rate = m.totalLots > 0
                    ? parseFloat((m.failLots / m.totalLots * 100).toFixed(1)) : 0;
                return {
                    month:      m.month,
                    totalLots:  m.totalLots,
                    failLots:   m.failLots,
                    passLots:   m.passLots,
                    failQtyFmt: _fmtQty(m.failQty),
                    rate:       rate,
                    rateFmt:    rate.toFixed(1) + "%",
                    rateState:  rate >= 10 ? "Error" : rate >= 3 ? "Warning" : "Success"
                };
            });

            oVM.setProperty("/monthlyData", aMonthly);
            oVM.setProperty("/hasMonthly",  aMonthly.length > 0);
            if (aMonthly.length) this._updateMonthlyChart(aMonthly);
        },

        _updateMonthlyChart: function (aData) {
            var oViz = this.byId("idMonthlyChart");
            if (!oViz) return;
            sap.ui.require([
                "sap/viz/ui5/data/FlattenedDataset",
                "sap/viz/ui5/controls/common/feeds/FeedItem"
            ], function (FlattenedDataset, FeedItem) {
                oViz.setVizType("column");
                oViz.setModel(new JSONModel({ data: aData }));
                oViz.setDataset(new FlattenedDataset({
                    dimensions: [{ name: "월", value: "{month}" }],
                    measures: [
                        { name: "합격 건수",   value: "{passLots}" },
                        { name: "불합격 건수", value: "{failLots}" }
                    ],
                    data: { path: "/data" }
                }));
                oViz.removeAllFeeds();
                oViz.addFeed(new FeedItem({ uid: "valueAxis",    type: "Measure",
                                            values: ["합격 건수", "불합격 건수"] }));
                oViz.addFeed(new FeedItem({ uid: "categoryAxis", type: "Dimension",
                                            values: ["월"] }));
                oViz.setVizProperties({
                    title:  { visible: false },
                    legend: { visible: true },
                    plotArea: {
                        colorPalette: ["#1565c0", "#bb0000"],
                        dataLabel: { visible: true }
                    },
                    valueAxis:    { title: { visible: true, text: "건수" } },
                    categoryAxis: { title: { visible: false } }
                });
            });
        },

        _loadMonthlyKpi: function () {
            var oVM    = this.getView().getModel("view");
            var oNow   = new Date();
            var oThisS = new Date(oNow.getFullYear(), oNow.getMonth(), 1);
            var oThisE = new Date(oNow.getFullYear(), oNow.getMonth() + 1, 0);
            var oLastS = new Date(oNow.getFullYear(), oNow.getMonth() - 1, 1);
            var oLastE = new Date(oNow.getFullYear(), oNow.getMonth(), 0);
            var oModel = this.getOwnerComponent().getModel();

            function _kpi(aRaw) {
                var nD = 0, nF = 0, nW = 0, fFQ = 0, fDQ = 0;
                aRaw.forEach(function (r) {
                    var fP  = parseFloat(r.PassQty) || 0;
                    var fFl = parseFloat(r.FailQty) || 0;
                    var bD  = (fP + fFl) > 0;
                    if (bD) { nD++; fDQ += fP + fFl; if (fFl > 0) { nF++; fFQ += fFl; } }
                    else    { nW++; }
                });
                return {
                    doneCount: nD, failCount: nF, waitCount: nW,
                    rate: fDQ > 0 ? (fFQ / fDQ * 100).toFixed(1) + "%" : "0.0%"
                };
            }

            function _filter(oS, oE) {
                return "Budat ge datetime'" + _iso(_yyyymmdd(oS)) + "T00:00:00'" +
                       " and Budat le datetime'" + _iso(_yyyymmdd(oE)) + "T23:59:59'";
            }

            var sThisLabel = oThisS.getFullYear() + "년 " + (oThisS.getMonth() + 1) + "월";
            var sLastLabel = oLastS.getFullYear() + "년 " + (oLastS.getMonth() + 1) + "월";

            oModel.read("/InspHeaderSet", {
                urlParameters: { $filter: _filter(oThisS, oThisE) },
                success: function (d) {
                    oVM.setProperty("/kpi/thisMonth", Object.assign({ label: sThisLabel }, _kpi(d.results || [])));
                    oVM.setProperty("/kpiVisible", true);
                }
            });
            oModel.read("/InspHeaderSet", {
                urlParameters: { $filter: _filter(oLastS, oLastE) },
                success: function (d) {
                    oVM.setProperty("/kpi/lastMonth", Object.assign({ label: sLastLabel }, _kpi(d.results || [])));
                    oVM.setProperty("/kpiVisible", true);
                }
            });
        },

        _updateChart: function (aData) {
            var oViz = this.byId("idDefectChart");
            if (!oViz) return;
            sap.ui.require([
                "sap/viz/ui5/data/FlattenedDataset",
                "sap/viz/ui5/controls/common/feeds/FeedItem"
            ], function (FlattenedDataset, FeedItem) {
                oViz.setVizType("column");
                oViz.setModel(new JSONModel({ data: aData }));
                oViz.setDataset(new FlattenedDataset({
                    dimensions: [{ name: "검수 LOT", value: "{Lot}" }],
                    measures: [
                        { name: "합격 수량",   value: "{PassQty}" },
                        { name: "불합격 수량", value: "{FailQty}" }
                    ],
                    data: { path: "/data" }
                }));
                oViz.removeAllFeeds();
                oViz.addFeed(new FeedItem({ uid: "valueAxis",    type: "Measure",
                                            values: ["합격 수량", "불합격 수량"] }));
                oViz.addFeed(new FeedItem({ uid: "categoryAxis", type: "Dimension",
                                            values: ["검수 LOT"] }));
                oViz.setVizProperties({
                    title:  { visible: false },
                    legend: { visible: true },
                    plotArea: {
                        dataLabel:    { visible: false },
                        colorPalette: ["#1565c0", "#bb0000"]
                    },
                    valueAxis:    { title: { visible: true, text: "수량 (EA)" } },
                    categoryAxis: { title: { visible: false } }
                });
            });
        },

        // ══ 자재코드 서치헬프 ══════════════════════════════════════
        onMatnrValueHelp: function () {
            var oVM  = this.getView().getModel("view");
            var aAll = oVM.getProperty("/allHeaders") || [];
            var that = this;

            function _openDialog(aItems) {
                var mMap = {};
                aItems.forEach(function (h) { if (h.Matnr) mMap[h.Matnr] = h.Maktx || ""; });
                var aList = Object.keys(mMap).sort().map(function (k) { return { Matnr: k, Maktx: mMap[k] }; });
                oVM.setProperty("/matnrList", aList);
                that.byId("idMatnrDialog").open();
            }

            if (aAll.length) {
                _openDialog(aAll);
            } else {
                oVM.setProperty("/busy", true);
                this.getOwnerComponent().getModel().read("/InspHeaderSet", {
                    success: function (d) {
                        oVM.setProperty("/busy", false);
                        _openDialog(d.results || []);
                    },
                    error: function () {
                        oVM.setProperty("/busy", false);
                        MessageToast.show("자재코드 목록을 불러올 수 없습니다.");
                    }
                });
            }
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
            var aFilters = sVal ? [new Filter("Matnr", FilterOperator.Contains, sVal)] : [];
            oEvent.getSource().getBinding("items").filter(aFilters);
        },

        // ══ 검수 목록 행 클릭 → 인라인 패널 ════════════════════
        onRowPress: function (oEvent) {
            var oHeader = Object.assign({}, oEvent.getSource().getBindingContext("view").getObject());
            var oVM     = this.getView().getModel("view");
            var that    = this;
            oVM.setProperty("/selectedPrueflos", oHeader.Prueflos);
            this._loadInspItems(oHeader, function (aItems) {
                that._showInlineDetail(oHeader, aItems);
            });
        },

        // ══ 클레임 행 클릭 → 결과 다이얼로그 ════════════════════
        onClaimRowPress: function (oEvent) {
            var oHeader = Object.assign({}, oEvent.getSource().getBindingContext("view").getObject());
            var that    = this;
            this._loadInspItems(oHeader, function (aItems) {
                that._openResultDialog(oHeader, aItems);
            });
        },

        // ══ 검수 시작 버튼 (검사대기 행) ════════════════════════
        onStartInsp: function (oEvent) {
            var oHeader = Object.assign({}, oEvent.getSource().getBindingContext("view").getObject());
            var oVM     = this.getView().getModel("view");
            var that    = this;
            oVM.setProperty("/selectedPrueflos", oHeader.Prueflos);
            this._loadInspItems(oHeader, function (aItems) {
                that._showInlineDetail(oHeader, aItems);
            });
        },

        // ══ 검사 항목 로드 ═════════════════════════════════════════
        _loadInspItems: function (oHeader, fnCb) {
            var oVM    = this.getView().getModel("view");
            var oModel = this.getOwnerComponent().getModel();
            oVM.setProperty("/busy", true);

            function _filter(aRaw) {
                return aRaw.filter(function (r) {
                    return r.Prueflos === oHeader.Prueflos && r.Matnr === oHeader.Matnr;
                });
            }

            oModel.read("/InspItemSet", {
                urlParameters: {
                    $filter: "Prueflos eq '" + oHeader.Prueflos + "' and Matnr eq '" + oHeader.Matnr + "'"
                },
                success: function (d) {
                    oVM.setProperty("/busy", false);
                    var aFiltered = _filter(d.results || []);
                    fnCb(aFiltered.length ? aFiltered : _defaultItems());
                },
                error: function () {
                    oModel.read("/InspItemSet", {
                        success: function (d2) {
                            oVM.setProperty("/busy", false);
                            var aFiltered = _filter(d2.results || []);
                            fnCb(aFiltered.length ? aFiltered : _defaultItems());
                        },
                        error: function () {
                            oVM.setProperty("/busy", false);
                            fnCb(_defaultItems());
                        }
                    });
                }
            });
        },

        // ══ 인라인 패널 표시 ══════════════════════════════════════
        _showInlineDetail: function (oHeader, aItems) {
            var oVM = this.getView().getModel("view");
            oVM.setProperty("/insp/header",      oHeader);
            oVM.setProperty("/insp/isCompleted",  oHeader.isCompleted);
            oVM.setProperty("/insp/total",        aItems.length);

            if (oHeader.isCompleted) {
                var fPass  = oHeader._passQty || 0;
                var fFail  = oHeader._failQty || 0;
                var fTotal = fPass + fFail;
                oVM.setProperty("/result/passQtyFmt", _fmtQty(fPass));
                oVM.setProperty("/result/failQtyFmt", _fmtQty(fFail));
                oVM.setProperty("/result/defectRate",
                    fTotal > 0 ? (Math.round(fFail / fTotal * 1000) / 10) + "%" : "0%");
                oVM.setProperty("/insp/items", aItems.map(function (r) {
                    var fFq = parseFloat(r.FailQty) || 0;
                    return { InspCd: r.InspCd || "", InspNm: r.InspNm || "",
                             Meins: r.Meins || "", inputFailQty: String(fFq) };
                }));
            } else {
                oVM.setProperty("/insp/items", aItems.map(function (r) {
                    return { InspCd: r.InspCd || "", InspNm: r.InspNm || "",
                             Meins: r.Meins || "", inputFailQty: "0" };
                }));
            }

            this.byId("idInspDialog").open();
        },

        // ══ 검수 다이얼로그 닫기 ══════════════════════════════════
        onCloseDetail: function () { this.onInspDialogClose(); },

        onInspDialogClose: function () {
            var oVM        = this.getView().getModel("view");
            var bCompleted = oVM.getProperty("/insp/isCompleted");
            var bEdited    = !bCompleted && (oVM.getProperty("/insp/items") || [])
                                 .some(function (i) { return (parseFloat(i.inputFailQty) || 0) > 0; });
            var that = this;
            if (bEdited) {
                MessageBox.confirm("입력한 내용이 저장되지 않습니다. 닫으시겠습니까?", {
                    actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                    onClose: function (s) {
                        if (s === MessageBox.Action.OK) {
                            that.byId("idInspDialog").close();
                            oVM.setProperty("/selectedPrueflos", "");
                        }
                    }
                });
            } else {
                this.byId("idInspDialog").close();
                oVM.setProperty("/selectedPrueflos", "");
            }
        },

        // ══ 전체 초기화 ════════════════════════════════════════════
        onResetAll: function () {
            var oVM    = this.getView().getModel("view");
            var aItems = oVM.getProperty("/insp/items");
            aItems.forEach(function (item) { item.inputFailQty = "0"; });
            oVM.setProperty("/insp/items", aItems);
        },

        // ══ 저장 ═══════════════════════════════════════════════════
        onInspSave: function () {
            var oVM    = this.getView().getModel("view");
            var aItems = oVM.getProperty("/insp/items");
            this._doSave(aItems);
        },

        _doSave: function (aItems) {
            var oVM     = this.getView().getModel("view");
            var oHeader = oVM.getProperty("/insp/header");
            var oModel  = this.getOwnerComponent().getModel();
            var that    = this;

            var fTotalFail = aItems.reduce(function (s, i) {
                return s + (parseFloat(i.inputFailQty) || 0);
            }, 0);
            var fQiQty = oHeader._qiQty || 0;
            var fFail  = Math.min(fTotalFail, fQiQty);
            var fPass  = Math.max(0, fQiQty - fFail);

            oVM.setProperty("/busy", true);

            var sHeaderKey = oModel.createKey("InspHeaderSet", {
                Prueflos: oHeader.Prueflos,
                PruefPos: oHeader.PruefPos
            });

            oModel.update("/" + sHeaderKey, {
                PassQty: String(fPass),
                FailQty: String(fFail)
            }, {
                merge: true,
                success: function () {
                    var nItems = aItems.length;
                    if (!nItems) { that._onSaveDone(oVM); return; }

                    var nDone = 0;
                    function _next() {
                        nDone++;
                        if (nDone === nItems) that._onSaveDone(oVM);
                    }

                    aItems.forEach(function (item) {
                        var sItemKey = oModel.createKey("InspItemSet", {
                            Prueflos: oHeader.Prueflos,
                            Matnr:    oHeader.Matnr,
                            InspCd:   item.InspCd
                        });
                        oModel.update("/" + sItemKey, {
                            FailQty: String(parseFloat(item.inputFailQty) || 0)
                        }, { merge: true, success: _next, error: _next });
                    });
                },
                error: function (e) {
                    oVM.setProperty("/busy", false);
                    var sMsg = "저장 실패";
                    try { sMsg = JSON.parse(e.responseText).error.message.value; } catch (x) {}
                    MessageBox.error("저장 오류: " + sMsg);
                }
            });
        },

        _onSaveDone: function (oVM) {
            oVM.setProperty("/busy", false);
            oVM.setProperty("/selectedPrueflos", "");
            MessageToast.show("검사 결과가 저장되었습니다.");
            this.byId("idInspDialog").close();
            this.onSearch();
        },

        // ══ 클레임 결과 다이얼로그 ════════════════════════════════
        _openResultDialog: function (oHeader, aRaw) {
            var oVM    = this.getView().getModel("view");
            var fPass  = oHeader._passQty || 0;
            var fFail  = oHeader._failQty || 0;
            var fTotal = fPass + fFail;
            var fRate  = fTotal > 0 ? (fFail / fTotal * 100) : 0;

            oVM.setProperty("/result/header",     oHeader);
            oVM.setProperty("/result/passQtyFmt", _fmtQty(fPass));
            oVM.setProperty("/result/failQtyFmt", _fmtQty(fFail));
            oVM.setProperty("/result/defectRate",
                fTotal > 0 ? (Math.round(fRate * 10) / 10) + "%" : "0%");
            oVM.setProperty("/result/meins", oHeader.Meins || "");
            oVM.setProperty("/result/items", aRaw.map(function (r) {
                var fFq = parseFloat(r.FailQty) || 0;
                return {
                    InspCd: r.InspCd || "", InspNm: r.InspNm || "",
                    FailQty: fFq, FailQtyFmt: _fmtQty(fFq), Meins: r.Meins || ""
                };
            }));
            this.byId("idResultDialog").open();
        },

        onResultClose: function () {
            this.byId("idResultDialog").close();
        }
    });
});
