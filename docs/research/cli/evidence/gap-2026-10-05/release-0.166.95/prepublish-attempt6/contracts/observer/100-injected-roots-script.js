(function() {
  if (!javax.swing.SwingUtilities.isEventDispatchThread())
    throw new Error('Swing diagnostics require EDT');
  var report = {schema:'chainlesschain.ui-failure-swing/v1',
    capturedAtMillis:String(java.lang.System.currentTimeMillis()),
    readOnly:true, nodeLimit:6000, depthLimit:50, truncated:false,
    windows:[], conversations:[], errors:[]};
  var count=0, owners=[];
  function shortText(value) {
    return value == null ? null : String(value).substring(0,256);
  }
  function error(where, failure) {
    report.errors.push({where:where, error:shortText(failure)});
  }
  function dimension(value) {return {width:Number(value.width),height:Number(value.height)};}
  function field(owner,name) {
    var declared=owner.getClass().getDeclaredField(name);
    declared.setAccessible(true); return declared.get(owner);
  }
  function scalar(owner,name) {
    try {var value=field(owner,name); return value == null ? null : String(value);}
    catch(failure) {error('field:'+name,failure);return null;}
  }
  function recordOwner(owner) {
    if (owners.indexOf(owner)>=0) return;
    owners.push(owner);
    var entry={sendInFlight:scalar(owner,'sendInFlight'),
      disposed:scalar(owner,'disposed'),turnActive:scalar(owner,'turnActive'),
      sessionGeneration:scalar(owner,'sessionGeneration')};
    try {
      var conv=field(owner,'conv');
      entry.sessionId=shortText(conv.getClass().getField('sessionId').get(conv));
      var session=conv.getClass().getField('session').get(conv);
      entry.sessionPresent=session != null;
      entry.pendingTurns=session == null ? null : Boolean(session.hasPendingTurns());
    } catch(failure) {error('conversation-session',failure);}
    try {
      var cards=field(owner,'approvalCards'), ids=cards.keySet().toArray();
      entry.approvalCardCount=Number(cards.size());entry.approvalIds=[];
      for(var i=0;i<ids.length && i<256;i++) entry.approvalIds.push(shortText(ids[i]));
      var settlements=field(owner,'approvalSettlements');
      entry.settlementCount=Number(settlements.size());
      var pending=field(settlements,'approvals').keySet().toArray();
      entry.settlementStates=[];
      for(var i=0;i<pending.length && i<256;i++)
        entry.settlementStates.push({id:shortText(pending[i]),status:shortText(settlements.status(String(pending[i])))});
    } catch(failure) {error('approval-state',failure);}
    report.conversations.push(entry);
  }
  function inspectListener(component) {
    if (!(component instanceof javax.swing.AbstractButton)
        || String(component.getText())!=='Send') return;
    var listeners=component.getActionListeners();
    for(var i=0;i<listeners.length;i++) {
      var fields=listeners[i].getClass().getDeclaredFields();
      for(var j=0;j<fields.length;j++) {
        try {
          fields[j].setAccessible(true);var value=fields[j].get(listeners[i]);
          if(value != null && String(value.getClass().getName())===
              'com.chainlesschain.ide.intellij.ConversationView') recordOwner(value);
        } catch(failure) {error('listener-owner',failure);}
      }
    }
  }
  function visit(component,depth) {
    if (count>=report.nodeLimit || depth>report.depthLimit) {
      report.truncated=true;return null;
    }
    count++;
    var bounds=component.getBounds();
    var node={className:String(component.getClass().getName()),
      visible:Boolean(component.isVisible()),showing:Boolean(component.isShowing()),
      enabled:Boolean(component.isEnabled()),valid:Boolean(component.isValid()),
      bounds:{x:Number(bounds.x),y:Number(bounds.y),width:Number(bounds.width),height:Number(bounds.height)},
      preferred:dimension(component.getPreferredSize()),children:[]};
    try {
      var accessible=component.getAccessibleContext();
      node.accessibleName=accessible == null ? null : shortText(accessible.getAccessibleName());
      if(component instanceof javax.swing.AbstractButton) node.buttonText=shortText(component.getText());
      if(component instanceof javax.swing.JComponent) {
        node.validateRoot=Boolean(component.isValidateRoot());
        node.visibleRect={x:Number(component.getVisibleRect().x),y:Number(component.getVisibleRect().y),
          width:Number(component.getVisibleRect().width),height:Number(component.getVisibleRect().height)};
      }
      inspectListener(component);
    } catch(failure) {error('component:'+node.className,failure);}
    if(component instanceof java.awt.Container) {
      node.layout=component.getLayout() == null ? null : String(component.getLayout().getClass().getName());
      var children=component.getComponents();
      for(var i=0;i<children.length;i++) {
        var child=visit(children[i],depth+1);if(child != null)node.children.push(child);
        if(count>=report.nodeLimit) {report.truncated=true;break;}
      }
    }
    return node;
  }
  var windows=roots;
  for(var i=0;i<windows.length;i++) {
    if(windows[i].isShowing()) {
      var window=visit(windows[i],0);if(window != null)report.windows.push(window);
    }
    if(count>=report.nodeLimit) {report.truncated=true;break;}
  }
  report.nodes=count;report.ownerCount=report.conversations.length;
  return JSON.stringify(report);
})();
