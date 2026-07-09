/*global QUnit*/

sap.ui.define([
	"zpe3/fi/financial/zpe3fifinancial/controller/FinancialView.controller"
], function (Controller) {
	"use strict";

	QUnit.module("FinancialView Controller");

	QUnit.test("I should test the FinancialView controller", function (assert) {
		var oAppController = new Controller();
		oAppController.onInit();
		assert.ok(oAppController);
	});

});
