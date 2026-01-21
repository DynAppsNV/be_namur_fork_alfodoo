/** @odoo-module **/

import { Component, useState } from "@odoo/owl";
import { Dialog } from "@web/core/dialog/dialog";
import { rpc } from "@web/core/network/rpc";

export class CmisLoginDialog extends Component {
  static template = "cmis_web.CmisLoginDialog";
  static components = { Dialog };

  static props = {
    close: Function,
    onSuccess: { type: Function, optional: true },
  };

  setup() {
    this.state = useState({
      username: "",
      password: "",
      error: null,
      loading: false,
    });
  }

  async onSubmit(ev) {
    ev?.preventDefault?.();
    this.state.error = null;
    this.state.loading = true;
    try {
      const res = await rpc("/cmis/set_credentials", {
        username: this.state.username,
        password: this.state.password,
      });
      if (!res?.ok) {
        this.state.error = `Connection refused (status ${res?.status || "?"})`;
        return;
      }
      this.props.onSuccess?.();
      this.loadSessionInfo();
      this.props.close();
      await this.queryCmisData();
    } catch (e) {
      this.state.error = "Error network / server";
    } finally {
      this.state.loading = false;
    }
  }

  // loadSessionInfo() {
  //     const res = rpc("/cmis/session_info", {});
  //     this.state.alfUser = res?.alf_user || null;
  //   }
}
