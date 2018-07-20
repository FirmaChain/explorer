import { connect } from 'react-redux';

import Navigation from './Navigation';


const mapStateToProps = ({ blockchain, global, widget }) => ({
  accounts: blockchain.accounts,
  last: blockchain.medState.height,

  page: global.page,

  loading: widget.loading,
});

export default connect(mapStateToProps)(Navigation);